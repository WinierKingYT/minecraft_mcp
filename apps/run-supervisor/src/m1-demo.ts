/**
 * M1 dikey dilim demo akışı.
 *
 * Demo tanımı (docs/delivery/roadmap.md M1):
 *   "AI istemcisi build edilen bir plugin'i disposable runtime'da başlatır;
 *    plugin READY durumunda yüklü ve etkindir, teşhis üretilir, runtime
 *    temiz bir şekilde kapatılır."
 *
 * Akış, MCP araçlarının IPC üzerinden çağırdığı handler'ların (service.ts
 * `handlers()`) birebir aynısını kullanır — yani build_id → plugin_launch
 * zinciri araç yüzeyiyle aynı kod yolundan geçer:
 *
 *   build.run ({backend})          → build_id + artifact (sha256)
 *     → runtime.create {build_id}  → artifact çözümleme + sha256 doğrulama
 *     → runtime.launch             → READY (ready gate)
 *     → bridge.query plugin.list   → build edilen plugin etkin mi
 *     → plugin.diagnose {runtimeId}
 *     → runtime.stop → runtime.release {discardImmediately}
 *
 * Bu akış GERÇEK Gradle build ve GERÇEK Paper başlatır; normal CI'da koşmaz:
 *   - Minecraft EULA kabulü gerektirir (kullanıcı kararı),
 *   - ~60 MB Paper JAR ve dünya üretimi gerektirir,
 *   - `container` backend Docker imajı (eclipse-temurin:25-jdk) ister.
 *
 * Nightly gerçek-Paper işine bağlanacaktır.
 */

import { mkdtemp, readdir, rm, cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadCompatibilityProfile, assertProfileUsable } from './compatibility.js';
import { SupervisorService } from './service.js';
import { ProjectRegistry } from './project-registry.js';
import { ContainerExecutionBackend } from './container-execution-backend.js';
import type { BuildRunResult, PluginDiagnoseResult, RuntimeSummary } from '@mcpdev/contracts';

export interface M1DemoOptions {
  readonly repoRoot: string;
  readonly profileId: string;
  readonly bridgeJarPath: string;
  readonly paperCacheDir: string;
  /** Runtime image'lerin oluşturulacağı kök; release sonrası GC burayı tarar. */
  readonly runtimeRootDir: string;
  /** Kayıtlı proje kimliği (slug). */
  readonly projectId: string;
  /** Kaynak proje kökü (FS-01: tool yüzeyinden değil, demo çağrısından gelir). */
  readonly projectRoot: string;
  /** Kullanıcının açık EULA kabulü. Varsayılan false. */
  readonly acceptMinecraftEula: boolean;
  /** Build backend'i. Varsayılan `container`; Docker yoksa trusted-local'e düşülür. */
  readonly backend?: 'container' | 'trusted-local';
  readonly keepRuntime?: boolean;
  readonly startupTimeoutMs?: number;
  readonly buildTimeoutMs?: number;
  /** Süreç bu demo için başlatıldıysa bittiğinde exit(0/1) yapılır (GC timer'ı event loop'u tutar). */
  readonly exitWhenDone?: boolean;
  readonly log?: (message: string) => void;
}

export interface M1DemoEvidence {
  readonly projectId: string;
  readonly backend: string;
  readonly build: BuildRunResult;
  readonly artifactSha256: string | null;
  readonly created: RuntimeSummary;
  readonly launched: RuntimeSummary;
  readonly plugins: Record<string, unknown>;
  readonly targetPluginEnabled: boolean;
  readonly diagnose: PluginDiagnoseResult;
  readonly stop: Record<string, unknown>;
  readonly released: RuntimeSummary;
  readonly gcSwept: boolean;
  readonly leftoverRuntimeDirs: readonly string[];
  readonly runtimeRoot: string;
}

export async function runM1Demo(options: M1DemoOptions): Promise<M1DemoEvidence> {
  const log = options.log ?? (() => {});
  const profile = loadCompatibilityProfile(options.repoRoot, options.profileId);
  assertProfileUsable(profile, 'prototype');
  log(`profil: ${profile.id} (${profile.verification.status})`);

  const projectRegistry = new ProjectRegistry();
  const project = await projectRegistry.register(options.projectId, {
    canonicalRoot: resolve(options.projectRoot),
    trustLevel: 'approved-fixture',
    allowedBackends: ['trusted-local', 'container'],
    defaultBackend: 'container',
  });
  log(`proje : ${project.id} (${project.trustLevel})`);

  const runtimeRoot = await mkdtemp(join(tmpdir(), 'mcpdev-m1-'));

  // Container backend `--network none` ile çalışır (Q3): wrapper dist'i ve
  // bağımlılıklar yalnızca seed'lenmiş cache üzerinden gelir. Trusted Local
  // backend de her build'de boş GRADLE_USER_HOME kullanır (isolated env);
  // aynı seed her iki backend'e verilir. Demo, host GRADLE_USER_HOME'unun
  // yalnızca wrapper dists + modules-2 alt dizinlerini kopyalar
  // (credential/properties içermez).
  const dependencyCacheDir = await seedGradleCache(runtimeRoot);

  let backend = options.backend ?? 'container';
  let containerBackend: ContainerExecutionBackend | undefined;
  if (backend === 'container') {
    containerBackend = new ContainerExecutionBackend({
      image: `eclipse-temurin:${profile.java.runtime_major}-jdk`,
      dependencyCacheDir,
      log: (level, event) => log(`[ctr] ${level} ${event}`),
    });
    const availability = await containerBackend.getAvailability();
    if (!availability.available) {
      log(`container backend yok (${availability.reason}); trusted-local'e düşülür`);
      backend = 'trusted-local';
    }
  }
  log(`backend: ${backend}`);

  const service = new SupervisorService({
    repoRoot: options.repoRoot,
    profileId: options.profileId,
    bridgeJarPath: options.bridgeJarPath,
    paperCacheDir: options.paperCacheDir,
    runtimeRootDir: runtimeRoot,
    version: '0.1.0-demo',
    projectRegistry,
    dependencyCacheDir,
    ...(containerBackend ? { containerExecutionBackend: containerBackend } : {}),
    log: (level, event) => log(`[svc] ${level} ${event}`),
  });

  const h = service.handlers();
  let createdRuntimeId: string | null = null;
  let evidence: M1DemoEvidence | null = null;
  try {
    const build = (await h['build.run']({
      projectId: options.projectId,
      mode: 'build',
      network: 'offline',
      backend,
      ...(options.buildTimeoutMs ? { timeoutMs: options.buildTimeoutMs } : {}),
    })) as BuildRunResult;
    log(`build : ${build.status} ${build.durationMs}ms build_id=${build.buildId}`);
    if (build.status !== 'completed' || !build.artifact) {
      throw new Error(
        `Build başarısız: ${build.status} (evidence: ${build.evidenceIds.join(', ') || 'yok'})`,
      );
    }
    log(`artifact: ${build.artifact.path} sha256=${build.artifact.sha256.slice(0, 16)}...`);

    const created = (await h['runtime.create']({
      acceptMinecraftEula: options.acceptMinecraftEula,
      buildId: build.buildId,
    })) as RuntimeSummary;
    createdRuntimeId = created.runtimeImageId;
    log(`runtime: ${created.runtimeImageId} state=${created.state}`);

    const launched = (await h['runtime.launch']({
      runtimeImageId: created.runtimeImageId,
    })) as RuntimeSummary;
    log(
      `ready  : state=${launched.state} readyGateMs=${launched.readyGateMs} port=${launched.bridgePort}`,
    );

    const plugins = (await h['bridge.query']({
      runtimeImageId: created.runtimeImageId,
      operation: 'plugin.list',
    })) as Record<string, unknown>;
    const pluginList = (plugins['plugins'] ?? []) as Array<Record<string, unknown>>;
    const targetPluginEnabled = pluginList.some(
      (p) => p['enabled'] === true && String(p['name']).toLowerCase().includes('minimal'),
    );
    log(`plugins: ${pluginList.length} yüklü; MinimalPlugin etkin=${targetPluginEnabled}`);

    const diagnose = (await h['plugin.diagnose']({
      runtimeId: created.runtimeImageId,
    })) as PluginDiagnoseResult;
    log(`diagnose: ${diagnose.summary}`);

    const stop = (await h['runtime.stop']({
      runtimeImageId: created.runtimeImageId,
    })) as Record<string, unknown>;
    log(`stop   : graceful=${stop['graceful']} port_released=${stop['portReleased']}`);

    const released = (await h['runtime.release']({
      runtimeImageId: created.runtimeImageId,
      discardImmediately: !options.keepRuntime,
    })) as RuntimeSummary;
    log(`release: state=${released.state} discarded=${!options.keepRuntime}`);

    const leftovers = (await readdir(runtimeRoot).catch(() => [])).filter((f) => f.startsWith('srv_'));
    log(`gc     : kalıntı dizin=${leftovers.length}`);

    evidence = {
      projectId: options.projectId,
      backend,
      build,
      artifactSha256: build.artifact.sha256,
      created,
      launched,
      plugins,
      targetPluginEnabled,
      diagnose,
      stop,
      released,
      gcSwept: leftovers.length === 0,
      leftoverRuntimeDirs: leftovers,
      runtimeRoot,
    };
  } finally {
    // Hata durumunda da runtime kapatılır; release için stop gerekir.
    if (createdRuntimeId) {
      try {
        const summary = (await h['runtime.get']({
          runtimeImageId: createdRuntimeId,
        })) as RuntimeSummary;
        if (summary.state === 'READY' || summary.state === 'STARTING') {
          await h['runtime.stop']({ runtimeImageId: createdRuntimeId });
        }
        if (summary.state === 'STOPPED' || summary.state === 'CRASHED') {
          await h['runtime.release']({ runtimeImageId: createdRuntimeId, discardImmediately: true });
        }
      } catch {
        // Registry'de değil; kalan dizini doğrudan temizle.
        const leftovers = await readdir(runtimeRoot).catch(() => []);
        for (const dir of leftovers.filter((f) => f.startsWith('srv_'))) {
          await rm(join(runtimeRoot, dir), { recursive: true, force: true }).catch(() => undefined);
        }
      }
    }
    if (!options.keepRuntime) {
      await rm(runtimeRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // GC tarayıcı interval'i event loop'u canlı tutar; CLI kullanımında süreç
  // kendiliğinden çıkmaz, bu yüzden demo bittiğinde açıkça çıkılır.
  if (options.exitWhenDone === true) {
    process.exit(evidence?.gcSwept === true ? 0 : 1);
  }
  return evidence!;
}

/**
 * Container build'i i�in host GRADLE_USER_HOME'undan seed kopyas� ��kar�r.
 *
 * Yaln�zca ger�ek gereksinimler kopyalan�r: wrapper dists (dist'in `.ok`
 * i�areti dahil) ve `caches/modules-2` (artifact + metadata). `.lck`/`.lock`/
 * `.tmp` dosyalar� process'e �zg�d�r ve atlan�r; `gradle.properties` gibi
 * credential ta��yabilecek dosyalar zaten kapsam d���ndad�r (Q6).
 */
export async function seedGradleCache(targetRoot: string): Promise<string> {
  const home = join(homedir(), '.gradle');
  const seed = join(targetRoot, 'gradle-seed');
  for (const rel of ['wrapper/dists', 'caches/modules-2']) {
    const src = join(home, rel);
    if (!existsSync(src)) {
      continue;
    }
    await mkdir(join(seed, dirname(rel)), { recursive: true });
    await cp(src, join(seed, rel), {
      recursive: true,
      filter: (source) => !/(\.lck|\.lock|\.tmp)$/.test(source),
    });
  }
  return seed;
}
