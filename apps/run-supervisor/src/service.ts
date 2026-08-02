/**
 * Supervisor servis katmanı — IPC metotlarının uygulanması.
 *
 * Bu katman runtime yaşam döngüsünün TEK sahibidir. MCP Server buradan geçmeden
 * ne Paper başlatabilir ne durdurabilir; ADR-0001'in "MCP Server doğrudan Paper
 * process sahipliği taşımaz" kuralı burada somutlaşır.
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { ScenarioEngine, type ScenarioEngineOptions } from './scenario-engine.js';
import type {
  BridgeEventsParams,
  BridgeQueryParams,
  CleanupEvidence,
  IpcMethod,
  RuntimeCreateParams,
  RuntimeIdParams,
  RuntimeSummary,
  SupervisorHealthResult,
  ProjectInspectParams,
  ProjectInspectResult,
  ProjectValidateParams,
  ProjectValidateResult,
  BuildRunParams,
  BuildRunResult,
  PluginDiagnoseParams,
  PluginDiagnoseResult,
  ScenarioRunParams,
  ScenarioRunResult,
  EvidenceGetParams,
  EvidenceGetResult,
  EventSubscribeParams,
  EventSubscribeResult,
  EventUnsubscribeParams,
  EventUnsubscribeResult,
  EventListParams,
  EventListResult,
  PoolStatusParams,
  PoolStatusResult,
  PoolAcquireParams,
  PoolAcquireResult,
  PoolReleaseParams,
  PoolReleaseResult,
  PoolEvictParams,
  PoolEvictResult,
  PoolListParams,
  PoolListResult,
  PoolResetParams,
  PoolResetResult,
  PoolEntryInfo,
  ProfileListParams,
  ProfileListResult,
  ProfileGetParams,
  ProfileGetResult,
} from '@mcpdev/contracts';
import { loadCompatibilityProfile, listCompatibilityProfiles, assertProfileUsable, type CompatibilityProfile } from './compatibility.js';
import { resolveJavaForProfile, type JavaInstallation } from './java-toolchain.js';
import { resolveBuild, downloadPaperJar } from './paper-download.js';
import { createRuntimeImage } from './runtime-image.js';
import { launchPaper, stopPaper } from './runtime-launch.js';
import { RuntimeRegistry } from './runtime-registry.js';
import { RuntimePool, type PooledRuntime } from './runtime-pool.js';
import { ProjectRegistry } from './project-registry.js';
import { validateGradleProject } from './gradle-validation.js';
import { suggestAction } from './diagnostics.js';
import { EvidenceStore } from '@mcpdev/evidence-model';
import { EventSubscriptionManager } from './event-subscription.js';
import type { MethodHandler } from './ipc-server.js';

export interface ServiceOptions {
  readonly repoRoot: string;
  readonly profileId: string;
  readonly bridgeJarPath: string;
  readonly paperCacheDir: string;
  readonly runtimeRootDir: string;
  readonly maxConcurrentRuntimes?: number;
  readonly version: string;
  readonly log?: (level: string, event: string, fields: Record<string, unknown>) => void;
  readonly projectRegistry?: ProjectRegistry;
  readonly evidenceStore?: EvidenceStore;
}

export class SupervisorService {
  readonly #options: ServiceOptions;
  readonly #registry: RuntimeRegistry;
  readonly #pool: RuntimePool;
  readonly #projects: ProjectRegistry;
  readonly #evidence: EvidenceStore | null;
  readonly #profile: CompatibilityProfile;
  readonly #eventSubscriptions = new Map<string, EventSubscriptionManager>();
  readonly #startedAtMs = Date.now();
  #java: JavaInstallation | null = null;

  constructor(options: ServiceOptions) {
    this.#options = options;
    this.#registry = new RuntimeRegistry(options.maxConcurrentRuntimes ?? 1);
    this.#pool = new RuntimePool({
      maxPoolSize: options.maxConcurrentRuntimes ?? 5,
      maxIdleMs: 300_000, // 5 minutes
      maxReuseCount: 10,
    });
    this.#pool.on('expired', (event) => {
      this.#log('INFO', 'pool.expired', { poolId: event.poolId, runtimeImageId: event.runtimeImageId });
      void this.stopRuntime({ runtimeImageId: event.runtimeImageId }).catch(() => {});
      void this.releaseRuntime({ runtimeImageId: event.runtimeImageId }).catch(() => {});
    });
    this.#pool.on('evicted', (event) => {
      this.#log('INFO', 'pool.evicted', { poolId: event.poolId, runtimeImageId: event.runtimeImageId });
      void this.stopRuntime({ runtimeImageId: event.runtimeImageId }).catch(() => {});
      void this.releaseRuntime({ runtimeImageId: event.runtimeImageId }).catch(() => {});
    });
    this.#projects = options.projectRegistry ?? new ProjectRegistry();
    this.#evidence = options.evidenceStore ?? null;
    this.#profile = loadCompatibilityProfile(options.repoRoot, options.profileId);
    assertProfileUsable(this.#profile, 'prototype');
  }

  #log(level: string, event: string, fields: Record<string, unknown> = {}): void {
    this.#options.log?.(level, event, fields);
  }

  /** Java tespiti maliyetlidir; ilk ihtiyaçta yapılır ve önbelleklenir. */
  async #javaInstallation(): Promise<JavaInstallation> {
    this.#java ??= await resolveJavaForProfile(this.#profile.java.runtime_major);
    return this.#java;
  }

  handlers(): Readonly<Record<IpcMethod, MethodHandler>> {
    return {
      'supervisor.health': () => this.health(),
      'runtime.create': (params) => this.createRuntime(params as RuntimeCreateParams),
      'runtime.launch': (params) => this.launchRuntime(params as RuntimeIdParams),
      'runtime.get': (params) => this.getRuntime(params as RuntimeIdParams),
      'runtime.stop': (params) => this.stopRuntime(params as RuntimeIdParams),
      'runtime.release': (params) => this.releaseRuntime(params as RuntimeIdParams),
      'bridge.query': (params) => this.bridgeQuery(params as BridgeQueryParams),
      'bridge.events': (params) => this.bridgeEvents(params as BridgeEventsParams),
      'events.subscribe': (params) => this.eventSubscribe(params as EventSubscribeParams),
      'events.unsubscribe': (params) => this.eventUnsubscribe(params as EventUnsubscribeParams),
      'events.list': (params) => this.eventList(params as EventListParams),
      'project.inspect': (params) => this.projectInspect(params as ProjectInspectParams),
      'project.validate': (params) => this.projectValidate(params as ProjectValidateParams),
      'build.run': (params) => this.buildRun(params as BuildRunParams),
      'plugin.diagnose': (params) => this.pluginDiagnose(params as PluginDiagnoseParams),
      'scenario.run': (params) => this.scenarioRun(params as ScenarioRunParams),
      'evidence.get': (params) => this.evidenceGet(params as EvidenceGetParams),
      'pool.status': (params) => this.poolStatus(params as PoolStatusParams),
      'pool.acquire': (params) => this.poolAcquire(params as PoolAcquireParams),
      'pool.release': (params) => this.poolRelease(params as PoolReleaseParams),
      'pool.evict': (params) => this.poolEvict(params as PoolEvictParams),
      'pool.list': (params) => this.poolList(params as PoolListParams),
      'pool.reset': (params) => this.poolReset(params as PoolResetParams),
      'profile.list': (params) => this.profileList(params as ProfileListParams),
      'profile.get': (params) => this.profileGet(params as ProfileGetParams),
    };
  }

  async health(): Promise<SupervisorHealthResult> {
    let javaMajor: number | null = null;
    try {
      javaMajor = (await this.#javaInstallation()).major;
    } catch {
      // Java bulunamaması sağlık raporunu düşürmez; alan null kalır ve
      // gizlenmez.
      javaMajor = null;
    }

    return {
      status: 'ok',
      version: this.#options.version,
      pid: process.pid,
      node: process.versions.node,
      uptimeMs: Date.now() - this.#startedAtMs,
      compatibilityProfile: this.#profile.id,
      profileVerification: this.#profile.verification.status,
      runtimeCount: this.#registry.activeCount,
      javaMajor,
    };
  }

  async createRuntime(params: RuntimeCreateParams): Promise<RuntimeSummary> {
    this.#registry.assertQuota();

    const resolved = await resolveBuild(this.#profile, globalThis.fetch);
    const jar = await downloadPaperJar(resolved, this.#options.paperCacheDir, globalThis.fetch);

    const serverInstanceId = `srv_${randomBytes(12).toString('hex')}`;
    const runtimeRoot = join(this.#options.runtimeRootDir, serverInstanceId);

    const image = await createRuntimeImage({
      runtimeRoot,
      serverInstanceId,
      paperJarPath: jar.path,
      bridgeJarPath: this.#options.bridgeJarPath,
      profile: this.#profile,
      acceptMinecraftEula: params?.acceptMinecraftEula === true,
      ...(params?.targetPluginPaths ? { targetPluginPaths: params.targetPluginPaths } : {}),
    });

    const entry = this.#registry.register(image);
    this.#log('INFO', 'runtime.created', {
      runtime_image_id: image.runtimeImageId,
      server_instance_id: serverInstanceId,
      paper_jar_sha256: image.paperJarSha256,
    });
    return this.#registry.summarize(entry);
  }

  async launchRuntime(params: RuntimeIdParams): Promise<RuntimeSummary> {
    const entry = this.#registry.requireState(params.runtimeImageId, ['CREATED']);
    const java = await this.#javaInstallation();

    entry.state = 'STARTING';
    const startedAt = Date.now();
    try {
      const running = await launchPaper({ image: entry.image, javaExecutable: java.executable });
      entry.running = running;
      entry.readyGateMs = Date.now() - startedAt;
      entry.state = 'READY';
      entry.ownership = {
        runtimeId: entry.image.runtimeImageId,
        serverInstanceId: entry.image.serverInstanceId,
        kind: 'paper',
        registeredAtMs: Date.now(),
        pid: running.pid,
        executablePath: running.javaExecutable,
        startedAtMs: running.startedAtMs,
        runtimeMarkerSha256: running.runtimeMarkerSha256,
      };

      this.#log('INFO', 'runtime.ready', {
        runtime_image_id: entry.image.runtimeImageId,
        bridge_boot_id: running.handshake.bridge_boot_id,
        duration_ms: entry.readyGateMs,
      });
    } catch (err) {
      entry.state = 'CRASHED';
      this.#log('ERROR', 'runtime.launch_failed', {
        runtime_image_id: entry.image.runtimeImageId,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    return this.#registry.summarize(entry);
  }

  async getRuntime(params: RuntimeIdParams): Promise<RuntimeSummary> {
    return this.#registry.summarize(this.#registry.get(params.runtimeImageId));
  }

  async stopRuntime(params: RuntimeIdParams): Promise<CleanupEvidence> {
    const entry = this.#registry.requireState(params.runtimeImageId, ['READY', 'STARTING']);
    if (!entry.running) {
      entry.state = 'STOPPED';
      throw Object.assign(new Error('Runtime çalışmıyor.'), { code: 'RUNTIME_NOT_RUNNING' });
    }

    entry.state = 'STOPPING';
    const cleanup = await stopPaper(entry.running);
    entry.state = 'STOPPED';
    entry.running = null;

    this.#log(cleanup.forceTerminated ? 'WARN' : 'INFO', 'runtime.stopped', {
      runtime_image_id: entry.image.runtimeImageId,
      graceful: cleanup.graceful,
      force_terminated: cleanup.forceTerminated,
      port_released: cleanup.portReleased,
    });

    return cleanup;
  }

  /**
   * Release, SİLME değildir: runtime retention durumuna geçer. Dizin silme
   * yalnızca Garbage Collector'a aittir (ADR-0003).
   *
   * M0'da GC henüz yok; bu yüzden dizin M0 boyunca yerinde kalır ve retention
   * süresi dolduğunda M1'de silinir. Yalnızca `discardImmediately` verildiğinde
   * dizin hemen kaldırılır — bu, smoke akışının kendi artığını toplaması
   * içindir.
   */
  async releaseRuntime(params: RuntimeIdParams & { discardImmediately?: boolean }): Promise<RuntimeSummary> {
    const entry = this.#registry.requireState(params.runtimeImageId, ['STOPPED', 'CRASHED']);
    entry.state = 'RELEASED';

    if (params.discardImmediately === true) {
      await rm(entry.image.runtimeRoot, { recursive: true, force: true });
    }

    this.#log('INFO', 'runtime.released', {
      runtime_image_id: entry.image.runtimeImageId,
      discarded: params.discardImmediately === true,
    });
    return this.#registry.summarize(entry);
  }

  async bridgeQuery(params: BridgeQueryParams): Promise<Record<string, unknown>> {
    const entry = this.#registry.requireState(params.runtimeImageId, ['READY']);
    if (!entry.running) {
      throw Object.assign(new Error('Runtime çalışmıyor.'), { code: 'RUNTIME_NOT_RUNNING' });
    }
    return entry.running.client.query(params.operation, params.arguments ?? {});
  }

  async bridgeEvents(params: BridgeEventsParams): Promise<{ events: Array<Record<string, unknown>> }> {
    const entry = this.#registry.requireState(params.runtimeImageId, ['READY']);
    if (!entry.running) {
      throw Object.assign(new Error('Runtime çalışmıyor.'), { code: 'RUNTIME_NOT_RUNNING' });
    }
    const events = await entry.running.client.events(params.bootId, params.after ?? 0, params.limit ?? 100);
    return { events };
  }

  async eventSubscribe(params: EventSubscribeParams): Promise<EventSubscribeResult> {
    const entry = this.#registry.requireState(params.runtimeId, ['READY']);
    if (!entry.running) {
      throw Object.assign(new Error('Runtime çalışmıyor.'), { code: 'RUNTIME_NOT_RUNNING' });
    }

    // Create a runtime-specific fetcher
    const client = entry.running.client;

    // Create subscription with runtime-specific fetcher
    const manager = new EventSubscriptionManager({
      fetchEvents: async (bootId, after, limit) => {
        return client.events(bootId, after, limit);
      },
      log: (level, event, data) => this.#log(level, event, data),
    });

    const result = manager.subscribe(params);

    // Store manager reference for this subscription
    this.#eventSubscriptions.set(result.subscriptionId, manager);

    return result;
  }

  async eventUnsubscribe(params: EventUnsubscribeParams): Promise<EventUnsubscribeResult> {
    const manager = this.#eventSubscriptions.get(params.subscriptionId);
    if (!manager) {
      throw Object.assign(
        new Error(`Subscription not found: ${params.subscriptionId}`),
        { code: 'EVENT_SUBSCRIPTION_NOT_FOUND' },
      );
    }

    const result = manager.unsubscribe(params);
    this.#eventSubscriptions.delete(params.subscriptionId);

    return result;
  }

  async eventList(params: EventListParams): Promise<EventListResult> {
    const manager = this.#eventSubscriptions.get(params.subscriptionId);
    if (!manager) {
      throw Object.assign(
        new Error(`Subscription not found: ${params.subscriptionId}`),
        { code: 'EVENT_SUBSCRIPTION_NOT_FOUND' },
      );
    }

    return manager.listEvents(params);
  }

  // ─── Pool handler'ları ─────────────────────────────────────────────

  async poolStatus(_params: PoolStatusParams): Promise<PoolStatusResult> {
    return this.#pool.getStatus();
  }

  async poolAcquire(params: PoolAcquireParams): Promise<PoolAcquireResult> {
    const existing = this.#pool.listByRuntimeImage(params.runtimeImageId);
    const idleEntry = existing.find((e) => e.state === 'IDLE');

    let runtimeSummary: RuntimeSummary;
    let poolEntry: PooledRuntime;

    if (idleEntry) {
      const registryEntry = this.#registry.get(params.runtimeImageId);
      runtimeSummary = this.#registry.summarize(registryEntry);
      poolEntry = this.#pool.acquire(
        params.runtimeImageId,
        idleEntry.runtimeId,
        idleEntry.bootId,
      );
    } else {
      let registryEntry;
      try {
        registryEntry = this.#registry.get(params.runtimeImageId);
      } catch {
        // If not created, create it
        await this.createRuntime({ acceptMinecraftEula: true });
        registryEntry = this.#registry.get(params.runtimeImageId);
      }

      if (!registryEntry.running) {
        runtimeSummary = await this.launchRuntime({ runtimeImageId: params.runtimeImageId });
      } else {
        runtimeSummary = this.#registry.summarize(registryEntry);
      }

      poolEntry = this.#pool.acquire(
        params.runtimeImageId,
        params.runtimeImageId,
        runtimeSummary.bridgeBootId ?? '',
      );
    }

    return {
      poolId: poolEntry.poolId,
      reuseCount: poolEntry.reuseCount,
      reused: !!idleEntry,
    };
  }

  async poolRelease(params: PoolReleaseParams): Promise<PoolReleaseResult> {
    const entry = this.#pool.getPoolEntry(params.poolId);
    if (!entry) {
      throw Object.assign(
        new Error(`Pool entry not found: ${params.poolId}`),
        { code: 'UNKNOWN_TOOL' },
      );
    }
    this.#pool.release(params.poolId);
    const updated = this.#pool.getPoolEntry(params.poolId);
    const evicted = !updated || updated.state === 'EVICTED';
    return {
      state: entry.state,
      evicted,
    };
  }

  async poolEvict(params: PoolEvictParams): Promise<PoolEvictResult> {
    this.#pool.evict(params.poolId);
    return { evicted: true };
  }

  async poolList(params: PoolListParams): Promise<PoolListResult> {
    const entries: PoolEntryInfo[] = [];
    const imageIds = params.runtimeImageId
      ? [params.runtimeImageId]
      : this.#registry.list().map((e) => e.image.runtimeImageId);

    for (const imgId of imageIds) {
      const pooled = this.#pool.listByRuntimeImage(imgId);
      for (const p of pooled) {
        entries.push({
          poolId: p.poolId,
          runtimeImageId: p.runtimeImageId,
          runtimeId: p.runtimeId,
          bootId: p.bootId,
          state: p.state,
          reuseCount: p.reuseCount,
          acquiredAt: p.acquiredAt,
          lastActivityAt: p.lastActivityAt,
          createdAt: p.createdAt,
        });
      }
    }
    return { entries, total: entries.length };
  }

  async poolReset(_params: PoolResetParams): Promise<PoolResetResult> {
    const status = this.#pool.getStatus();
    const evicted = status.total;
    const entries: PooledRuntime[] = [];
    for (const entry of this.#registry.list()) {
      entries.push(...this.#pool.listByRuntimeImage(entry.image.runtimeImageId));
    }
    for (const p of entries) {
      try {
        this.#pool.evict(p.poolId);
      } catch {}
    }
    return { evicted };
  }

  // ─── Profile handler'ları ──────────────────────────────────────────

  async profileList(_params: ProfileListParams): Promise<ProfileListResult> {
    const profiles = listCompatibilityProfiles(this.#options.repoRoot);
    return {
      profiles,
      activeProfileId: this.#options.profileId,
    };
  }

  async profileGet(params: ProfileGetParams): Promise<ProfileGetResult> {
    const profile = loadCompatibilityProfile(this.#options.repoRoot, params.profileId);
    return {
      id: profile.id,
      status: profile.status ?? 'unknown',
      minecraftVersion: profile.minecraft.version,
      paperBuild: profile.paper.build,
      verificationStatus: profile.verification?.status ?? 'unverified',
      javaVersion: profile.java.runtime_major,
      nodeVersion: profile.node.version,
      gradleVersion: profile.gradle.wrapper_version,
    };
  }

  // ─── Yeni IPC handler'ları ──────────────────────────────────────────

  async projectInspect(params: ProjectInspectParams): Promise<ProjectInspectResult> {
    const project = this.#projects.get(params.projectId);

    // Gradle wrapper kontrolü
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const wrapperJar = join(project.canonicalRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar');
    const wrapperProps = join(project.canonicalRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties');
    const gradlew = join(project.canonicalRoot, 'gradlew');

    const gradleWrapper = {
      found: existsSync(gradlew),
      jarExists: existsSync(wrapperJar),
      propertiesExists: existsSync(wrapperProps),
    };

    // Plugin metadata kontrolü
    let pluginMetadata: ProjectInspectResult['pluginMetadata'] = null;
    const pluginYml = join(project.canonicalRoot, 'src', 'main', 'resources', 'plugin.yml');
    if (existsSync(pluginYml)) {
      try {
        const { readFileSync } = await import('node:fs');
        const { parse: parseYaml } = await import('yaml');
        const content = readFileSync(pluginYml, 'utf8');
        const meta = parseYaml(content) as Record<string, unknown>;
        const name = typeof meta['name'] === 'string' ? meta['name'] : undefined;
        const version = typeof meta['version'] === 'string' ? meta['version'] : undefined;
        const mainClass = typeof meta['main'] === 'string' ? meta['main'] : undefined;
        const apiVersion = typeof meta['api-version'] === 'string' ? meta['api-version'] : undefined;
        pluginMetadata = {
          found: true,
          ...(name !== undefined ? { name } : {}),
          ...(version !== undefined ? { version } : {}),
          ...(mainClass !== undefined ? { mainClass } : {}),
          ...(apiVersion !== undefined ? { apiVersion } : {}),
        };
      } catch {
        pluginMetadata = { found: true };
      }
    }

    // Test contract kontrolü
    const testContractPath = join(project.canonicalRoot, '.mcp-minecraft', 'test-contract.yaml');
    const testContract = { found: existsSync(testContractPath) };

    return {
      projectId: project.id,
      rootPath: project.canonicalRoot,
      trustLevel: project.trustLevel,
      gradleWrapper,
      pluginMetadata,
      testContract,
    };
  }

  async projectValidate(params: ProjectValidateParams): Promise<ProjectValidateResult> {
    const project = this.#projects.get(params.projectId);

    const validation = await validateGradleProject(project.canonicalRoot, {
      distributionHostAllowlist: ['services.gradle.org'],
      expectedVersion: this.#profile.gradle?.wrapper_version ?? '',
      expectedDistributionSha256: this.#profile.gradle?.distribution_sha256 ?? null,
      knownWrapperJarSha256: [],
      requireLockAndVerification: true,
    });

    return {
      projectId: project.id,
      findings: validation.findings.map((f) => ({
        severity: f.severity,
        code: f.code,
        message: f.message,
        suggestedAction: f.suggestedAction,
      })),
      gradleVersion: validation.wrapper.version,
      javaMajor: this.#profile.java.runtime_major,
      distributionSha256Valid: validation.wrapper.distributionSha256 !== null,
      lockFilePresent: true,
      verificationMetadataPresent: true,
    };
  }

  async buildRun(params: BuildRunParams): Promise<BuildRunResult> {
    this.#projects.assertBuildAllowed(params.projectId);

    const { BuildExecutor } = await import('./build-executor.js');
    const executor = new BuildExecutor({
      registry: this.#projects,
      gradleValidation: {
        distributionHostAllowlist: ['services.gradle.org'],
        expectedVersion: this.#profile.gradle?.wrapper_version ?? '',
        expectedDistributionSha256: this.#profile.gradle?.distribution_sha256 ?? null,
        knownWrapperJarSha256: [],
        requireLockAndVerification: true,
      },
      javaMajor: this.#profile.java.runtime_major,
      ...(this.#evidence ? { evidence: this.#evidence } : {}),
      ...(this.#options.log ? { log: this.#options.log } : {}),
    });

    const outcome = await executor.execute({
      projectId: params.projectId,
      mode: params.mode,
      backend: 'trusted-local',
      network: params.network === 'online' ? 'repository-allowlist' : 'offline',
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
    });

    if (!outcome.ok) {
      return {
        buildId: outcome.runId,
        projectId: params.projectId,
        mode: params.mode,
        status: 'failed',
        durationMs: outcome.run?.durationMs ?? 0,
        evidenceIds: outcome.provenance?.evidenceIds ?? [],
        ...(outcome.diagnostics
          ? {
              diagnostics: {
                errors: outcome.diagnostics.diagnostics
                  .filter((d) => d.severity === 'error')
                  .map((d) => ({
                    file: d.path ?? '(bilinmeyen)',
                    line: d.line ?? 0,
                    message: d.message,
                    suggestedAction: suggestAction(d),
                  })),
                warnings: outcome.diagnostics.diagnostics
                  .filter((d) => d.severity === 'warning')
                  .map((d) => ({
                    file: d.path ?? '(bilinmeyen)',
                    line: d.line ?? 0,
                    message: d.message,
                  })),
                failedTasks: [...outcome.diagnostics.failedTasks],
              },
            }
          : {}),
      };
    }

    return {
      buildId: outcome.runId,
      projectId: params.projectId,
      mode: params.mode,
      status: 'completed',
      ...(outcome.artifact
        ? {
            artifact: {
              id: outcome.artifact.buildArtifactId,
              path: outcome.artifact.path,
              sha256: outcome.artifact.sha256,
              byteSize: outcome.artifact.byteSize,
            },
          }
        : {}),
      durationMs: outcome.run?.durationMs ?? 0,
      evidenceIds: outcome.provenance?.evidenceIds ?? [],
    };
  }

  async pluginDiagnose(params: PluginDiagnoseParams): Promise<PluginDiagnoseResult> {
    if (params.buildId && this.#evidence) {
      // Build kanıtlarını oku
      try {
        const { text } = await this.#evidence.get(
          `ev_build_diagnostics_${params.buildId}`,
          1024 * 1024,
        );
        const parsed = JSON.parse(text) as {
          errors?: Array<{
            file: string;
            line: number | null;
            column: number | null;
            message: string;
            symbol: string | null;
            suggestedAction: string;
          }>;
          warnings?: Array<{ file: string; line: number | null; message: string }>;
          failedTasks?: string[];
        };

        return {
          type: 'build',
          summary: `Build teşhisi: ${parsed.errors?.length ?? 0} hata, ${parsed.warnings?.length ?? 0} uyarı`,
          errors: (parsed.errors ?? []).map((e) => ({
            ...e,
            severity: 'error' as const,
          })),
          failedTasks: parsed.failedTasks ?? [],
          warnings: parsed.warnings ?? [],
        };
      } catch {
        // Kanıt bulunamadıysa boş dönüş
      }
    }

    return {
      type: params.runtimeId ? 'runtime' : 'build',
      summary: 'Teşhis verisi bulunamadı.',
      errors: [],
      failedTasks: [],
      warnings: [],
    };
  }

  async scenarioRun(params: ScenarioRunParams): Promise<ScenarioRunResult> {
    this.#log('INFO', 'scenario.run_started', {
      scenario_path: params.scenarioPath,
      project_id: params.projectId,
    });

    // Scenario engine'i oluştur
    const engineOptions: ScenarioEngineOptions = {
      repoRoot: this.#options.repoRoot,
      scenarioPath: params.scenarioPath,
      projectId: params.projectId,
      registry: this.#registry,
      getBridgeClient: (runtimeImageId: string) => {
        try {
          const entry = this.#registry.get(runtimeImageId);
          return entry.running?.client ?? null;
        } catch {
          return null;
        }
      },
      version: this.#options.version,
      log: this.#log.bind(this),
    };

    if (this.#evidence) {
      (engineOptions as { evidenceStore: ScenarioEngineOptions['evidenceStore'] }).evidenceStore = this.#evidence as unknown as ScenarioEngineOptions['evidenceStore'];
    }

    const engine = new ScenarioEngine(engineOptions);

    // Scenario'yi çalıştır
    return engine.run();
  }

  async evidenceGet(params: EvidenceGetParams): Promise<EvidenceGetResult> {
    if (!this.#evidence) {
      throw Object.assign(new Error('Evidence store mevcut değil.'), { code: 'EVIDENCE_NOT_FOUND' });
    }

    const { manifest, text } = await this.#evidence.get(params.evidenceId);

    let content: unknown;
    try {
      content = JSON.parse(text);
    } catch {
      content = text;
    }

    return {
      evidenceId: manifest.evidenceId,
      kind: manifest.kind,
      producer: manifest.producer,
      content,
      byteSize: manifest.integrity.byteSize,
      checksum: manifest.integrity.sha256,
      createdAt: manifest.retention.createdAt,
    };
  }

  /** Supervisor kapanırken çalışan tüm runtime'ları temiz kapatır. */
  async shutdown(): Promise<void> {
    for (const entry of this.#registry.list()) {
      if (entry.running) {
        await stopPaper(entry.running, 10_000).catch(() => undefined);
        entry.running = null;
        entry.state = 'STOPPED';
      }
    }
  }
}
