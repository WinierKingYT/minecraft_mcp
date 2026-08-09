/**
 * M2A dikey dilim demo akışı.
 *
 * Demo tanımı (docs/delivery/roadmap.md M2A):
 *   "Scenario engine'i gerçek runtime'a bağlar: her scenario kendi disposable
 *    runtime'ında koşar, assertion'lar bridge query'leriyle değerlendirilir
 *    ve runtime temiz kapatılır."
 *
 * Akış, MCP araçlarının IPC üzerinden çağırdığı handler'ların (service.ts
 * `handlers()`) birebir aynısını kullanır — scenario_run zinciri araç
 * yüzeyiyle aynı kod yolundan geçer:
 *
 *   (opsiyonel) build.run {backend}        → build_id (plugin-enables için)
 *     → scenario.run {scenarioPath, acceptMinecraftEula, buildId?}
 *         → runtime.create (determinism profili + fixture manifest)
 *         → runtime.launch                 → READY
 *         → engine: given/when/then adımları (bridge query/action + events)
 *         → disposeRuntime: stop → release (cleanup kanıtı)
 *   → gc kalıntı kontrolü
 *
 * Bu akış GERÇEK Paper başlatır; normal CI'da koşmaz:
 *   - Minecraft EULA kabulü gerektirir (kullanıcı kararı),
 *   - ~60 MB Paper JAR ve dünya üretimi gerektirir,
 *   - plugin-enables scenario'su için Gradle build (trusted-local) gerekir.
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCompatibilityProfile, assertProfileUsable } from './compatibility.js';
import { SupervisorService } from './service.js';
import { ProjectRegistry } from './project-registry.js';
import { ContainerExecutionBackend } from './container-execution-backend.js';
import { seedGradleCache } from './m1-demo.js';
import { generateScenarioReports } from './scenario-report.js';
import type { BuildRunResult, ScenarioRunResult } from '@mcpdev/contracts';

export interface M2ADemoOptions {
  readonly repoRoot: string;
  readonly profileId: string;
  readonly bridgeJarPath: string;
  readonly paperCacheDir: string;
  /** Runtime image'lerin oluşturulacağı kök; release sonrası GC burayı tarar. */
  readonly runtimeRootDir?: string;
  /** Kayıtlı proje kimliği (slug). */
  readonly projectId: string;
  /** Kaynak proje kökü (plugin-enables scenario'su için build gerekir). */
  readonly projectRoot: string;
  /** Kullanıcının açık EULA kabulü. Varsayılan false. */
  readonly acceptMinecraftEula: boolean;
  /** Build backend'i. Varsayılan `trusted-local`; container Docker ister. */
  readonly backend?: 'container' | 'trusted-local';
  /** Plugin-enables scenario'sunu da koş (minimal-paper-plugin build edilir). */
  readonly pluginScenario?: boolean;
  /** Config error scenario'larını da koş (scenarios/configuration/*, DSL-12). */
  readonly errorScenarios?: boolean;
  /** Verilirse scenario raporları (JSON/Markdown/JUnit) bu dizine yazılır. */
  readonly reportDir?: string;
  readonly startupTimeoutMs?: number;
  readonly buildTimeoutMs?: number;
  /** Süreç bu demo için başlatıldıysa bittiğinde exit(0/1) yapılır (GC timer'ı event loop'u tutar). */
  readonly exitWhenDone?: boolean;
  readonly log?: (message: string) => void;
}

export interface ScenarioRunEvidence {
  readonly scenarioPath: string;
  readonly scenarioRunId: string;
  readonly status: string;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly durationMs: number;
  readonly evidenceIds: readonly string[];
}

export interface M2ADemoEvidence {
  readonly backend: string;
  readonly buildId: string | null;
  readonly artifactSha256: string | null;
  readonly scenarios: ScenarioRunEvidence[];
  readonly gcSwept: boolean;
  readonly leftoverRuntimeDirs: readonly string[];
  readonly runtimeRoot: string;
  readonly reports?: {
    readonly reportId: string;
    readonly jsonPath: string;
    readonly markdownPath: string;
    readonly junitPath: string;
  };
}

export async function runM2ADemo(options: M2ADemoOptions): Promise<M2ADemoEvidence> {
  const log = options.log ?? (() => {});
  const profile = loadCompatibilityProfile(options.repoRoot, options.profileId);
  assertProfileUsable(profile, 'prototype');
  log(`profil: ${profile.id} (${profile.verification.status})`);

  const projectRegistry = new ProjectRegistry();
  const project = await projectRegistry.register(options.projectId, {
    canonicalRoot: resolve(options.projectRoot),
    trustLevel: 'approved-fixture',
    allowedBackends: ['trusted-local', 'container'],
    defaultBackend: 'trusted-local',
  });
  log(`proje : ${project.id} (${project.trustLevel})`);

  const runtimeRoot = options.runtimeRootDir ?? (await mkdtemp(join(tmpdir(), 'mcpdev-m2a-')));

  const dependencyCacheDir = await seedGradleCache(runtimeRoot);

  let backend = options.backend ?? 'trusted-local';
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
    log: (level, event, fields) =>
      log(`[svc] ${level} ${event}${fields ? ` ${JSON.stringify(fields)}` : ''}`),
  });

  const h = service.handlers();

  let buildId: string | null = null;
  let artifactSha256: string | null = null;

  try {
    // Plugin scenario'su için önce plugin build edilir (trusted-local, offline).
    if (options.pluginScenario === true) {
      log(`build : ${options.projectId} (${backend}, offline)`);
      const build = (await h['build.run']({
        projectId: options.projectId,
        mode: 'build',
        network: 'offline',
        backend,
      })) as BuildRunResult;
      buildId = build.buildId;
      artifactSha256 = build.artifact?.sha256 ?? null;
      log(`build : ${buildId}, sha256=${artifactSha256}`);
    }

    const scenarioPaths: string[] = [
      resolve(options.repoRoot, 'scenarios', 'world', 'read-block.yaml'),
      resolve(options.repoRoot, 'scenarios', 'world', 'chunk-ticket.yaml'),
    ];
    if (buildId) {
      scenarioPaths.push(resolve(options.repoRoot, 'scenarios', 'smoke', 'plugin-enables.yaml'));
    }
    if (options.errorScenarios === true) {
      scenarioPaths.push(
        resolve(options.repoRoot, 'scenarios', 'configuration', 'region-not-allowed.yaml'),
        resolve(options.repoRoot, 'scenarios', 'configuration', 'material-not-allowed.yaml'),
        resolve(options.repoRoot, 'scenarios', 'configuration', 'chunk-not-loaded.yaml'),
      );
    }

    const scenarios: ScenarioRunEvidence[] = [];
    for (const scenarioPath of scenarioPaths) {
      log(`scenario: ${scenarioPath} başlatılıyor...`);
      try {
        const result = (await service.scenarioRun({
          scenarioPath,
          projectId: options.projectId,
          acceptMinecraftEula: options.acceptMinecraftEula,
          ...(buildId ? { buildId } : {}),
        })) as ScenarioRunResult;
        log(
          `scenario: status=${result.status} passed=${result.passed} failed=${result.failed} ` +
            `duration_ms=${result.durationMs} evidence=${result.evidenceIds.length}`,
        );
        scenarios.push({
          scenarioPath,
          scenarioRunId: result.scenarioRunId,
          status: result.status,
          passed: result.passed,
          failed: result.failed,
          skipped: result.skipped,
          durationMs: result.durationMs,
          evidenceIds: result.evidenceIds,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`scenario: HATA ${message}`);
        scenarios.push({
          scenarioPath,
          scenarioRunId: 'n/a',
          status: 'error',
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 0,
          evidenceIds: [],
        });
      }
    }

    const leftovers = (await readdir(runtimeRoot).catch(() => [])).filter((f) => f.startsWith('srv_'));
    log(`gc     : kalıntı dizin=${leftovers.length}`);

    // Rapor üretimi (JSON/Markdown/JUnit, tek report_id).
    let reports: M2ADemoEvidence['reports'];
    if (options.reportDir) {
      const outputs = await generateScenarioReports(
        {
          runId: buildId ?? `run_${Date.now()}`,
          compatibilityProfile: profile.id,
          fixtureId: 'flat-world-v1',
          ...(options.projectId ? { projectId: options.projectId } : {}),
          ...(buildId ? { buildArtifactId: `bart_${artifactSha256?.slice(0, 12)}` } : {}),
          scenarios: scenarios.map((s) => ({
            scenarioId: s.scenarioPath.split('\\').pop()!.split('/').pop()!.replace(/\.yaml$/, ''),
            scenarioPath: s.scenarioPath.replace(/^.*?scenarios[\\/]/, 'scenarios/'),
            scenarioRunId: s.scenarioRunId,
            status: s.status as 'completed' | 'failed' | 'timed_out',
            passed: s.passed,
            failed: s.failed,
            skipped: s.skipped,
            durationMs: s.durationMs,
            evidenceIds: s.evidenceIds,
          })),
        },
        options.reportDir,
      );
      reports = outputs;
      log(`rapor : ${outputs.reportId} (${outputs.jsonPath})`);
    }

    return {
      backend,
      buildId,
      artifactSha256,
      scenarios,
      gcSwept: leftovers.length === 0,
      leftoverRuntimeDirs: leftovers,
      runtimeRoot,
      ...(reports ? { reports } : {}),
    };
  } finally {
    await service.shutdown().catch(() => undefined);
    await rm(runtimeRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * CLI giriş noktası: `node dist/src/m2a-demo.js <profileId> <projectId> <repoRoot> <bridgeJarPath> <paperCacheDir> [--plugin] [--container]`
 */
export async function runM2ADemoCli(args: string[]): Promise<void> {
  const [profileId = 'paper-26.2-build-84-v1', projectId = 'minimal-paper-plugin', repoRoot = process.cwd(), bridgeJarPath, paperCacheDir] = args;
  const pluginScenario = args.includes('--plugin');
  const errorScenarios = args.includes('--errors');
  const backend = args.includes('--container') ? 'container' : 'trusted-local';
  const eulaAccepted = args.includes('--eula');

  if (!eulaAccepted) {
    console.error('EULA kabulü gerekli: --eula bayrağı ile çalıştırın.');
    process.exit(2);
  }
  if (!bridgeJarPath || !paperCacheDir) {
    console.error('bridgeJarPath ve paperCacheDir zorunludur.');
    process.exit(2);
  }

  const evidence = await runM2ADemo({
    repoRoot,
    profileId,
    bridgeJarPath,
    paperCacheDir,
    projectId,
    projectRoot: resolve(repoRoot, 'fixtures', 'projects', projectId),
    acceptMinecraftEula: true,
    backend,
    pluginScenario,
    errorScenarios,
    exitWhenDone: true,
    log: (m) => console.log(m),
  });

  console.log('=== M2A DEMO EVIDENCE ===');
  console.log(JSON.stringify(evidence, null, 2));
}
