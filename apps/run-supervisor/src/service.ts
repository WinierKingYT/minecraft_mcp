/**
 * Supervisor servis katmanı — IPC metotlarının uygulanması.
 *
 * Bu katman runtime yaşam döngüsünün TEK sahibidir. MCP Server buradan geçmeden
 * ne Paper başlatabilir ne durdurabilir; ADR-0001'in "MCP Server doğrudan Paper
 * process sahipliği taşımaz" kuralı burada somutlaşır.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { ActorClient } from './actor-client.js';
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
  PermissionAttachParams,
  PermissionAttachResult,
  PermissionDetachParams,
  PermissionDetachResult,
  PermissionCheckParams,
  PermissionCheckResult,
  PermissionSetOpParams,
  PermissionSetOpResult,
  ProjectListParams,
  ProjectListResult,
} from '@mcpdev/contracts';
import { loadCompatibilityProfile, listCompatibilityProfiles, assertProfileUsable, type CompatibilityProfile } from './compatibility.js';
import { resolveJavaForProfile, type JavaInstallation } from './java-toolchain.js';
import { resolveBuild, downloadPaperJar } from './paper-download.js';
import { createRuntimeImage } from './runtime-image.js';
import { launchPaper, stopPaper } from './runtime-launch.js';
import { RuntimeRegistry } from './runtime-registry.js';
import { PersistentRuntimeRegistry } from './persistent-registry.js';
import { RuntimeGarbageCollector } from './runtime-gc.js';
import { RuntimePool, type PooledRuntime } from './runtime-pool.js';
import { ProjectRegistry } from './project-registry.js';
import { PersistentProjectRegistry } from './persistent-project-registry.js';
import { validateGradleProject } from './gradle-validation.js';
import { suggestAction } from './diagnostics.js';
import { EvidenceStore } from '@mcpdev/evidence-model';
import { EventSubscriptionManager } from './event-subscription.js';
import { PermissionAdapter } from './permission-adapter.js';
import { ContainerExecutionBackend } from './container-execution-backend.js';
import { BuildRegistry } from './build-registry.js';
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
  /**
   * Proje registry kalıcılık dosyası. Verilirse kayıtlar disk'e yazılır ve
   * startup'ta geri yüklenir (P0-4k); verilmezse registry bellek içi kalır.
   */
  readonly projectRegistryFilePath?: string;
  readonly evidenceStore?: EvidenceStore;
  /**
   * Runtime registry kalıcılık dosyası. Verilirse registry disk'e yazılır ve
   * startup'ta geri yüklenir (runtime-registry.json).
   */
  readonly registryFilePath?: string;
  /** Release sonrası dizinlerin retention süresi (ms). Varsayılan: 24 saat. */
  readonly runtimeRetentionMs?: number;
  /** GC tarama aralığı (ms). Varsayılan: 5 dakika. */
  readonly garbageCollectorSweepMs?: number;
  /** Container build backend; verilmezse varsayılan oluşturulur. */
  readonly containerExecutionBackend?: ContainerExecutionBackend;
  /**
   * Build artifact'larının kopyalandığı kalıcı depo kökü (M1).
   * Varsayılan: `<repoRoot>/.mcpdev-data/artifacts`.
   */
  readonly artifactStoreDir?: string;
  /**
   * Build'lerin kullandığı doğrulanmış dependency cache (offline reproducible).
   * Verilmezse trusted-local backend her build'de boş GRADLE_USER_HOME kullanır
   * ve offline mod bağımlılık çözemez; provisioning bu dizini doldurur.
   */
  readonly dependencyCacheDir?: string;
  /**
   * Fixture manifest dosyası (YAML). Verilirse her runtime image'e
   * `mcpdev-fixture.json` olarak kopyalanır; Bridge dünya mutation'ları
   * (world.set_block, world.set_chunk_ticket) buradaki bölge/materyal
   * sınırlarına göre çalışır. Varsayılan: `<repoRoot>/fixtures/manifests/flat-world-v1.yaml`.
   */
  readonly fixtureManifestPath?: string;
}

export class SupervisorService {
  readonly #options: ServiceOptions;
  readonly #registry: RuntimeRegistry;
  readonly #garbageCollector: RuntimeGarbageCollector;
  readonly #pool: RuntimePool;
  readonly #projects: ProjectRegistry;
  readonly #evidence: EvidenceStore | null;
  readonly #profile: CompatibilityProfile;
  readonly #eventSubscriptions = new Map<string, EventSubscriptionManager>();
  readonly #permissionAdapter: PermissionAdapter;
  readonly #startedAtMs = Date.now();
  readonly #builds = new BuildRegistry();
  #java: JavaInstallation | null = null;
  #registryLoaded: Promise<void> | null = null;
  #projectsLoaded: Promise<void> | null = null;
  #containerExecution: ContainerExecutionBackend | null = null;
  readonly #fixtureManifest: Readonly<Record<string, unknown>> | null;

  constructor(options: ServiceOptions) {
    this.#options = options;
    const maxConcurrent = options.maxConcurrentRuntimes ?? 1;
    this.#registry = options.registryFilePath
      ? new PersistentRuntimeRegistry({
          filePath: options.registryFilePath,
          maxConcurrent,
          ...(options.log ? { log: options.log } : {}),
        })
      : new RuntimeRegistry(maxConcurrent);
    this.#garbageCollector = new RuntimeGarbageCollector({
      registry: this.#registry,
      runtimeRootDir: options.runtimeRootDir,
      ...(options.runtimeRetentionMs !== undefined ? { retentionMs: options.runtimeRetentionMs } : {}),
      ...(options.garbageCollectorSweepMs !== undefined ? { sweepIntervalMs: options.garbageCollectorSweepMs } : {}),
      ...(options.log ? { log: options.log } : {}),
      onChange: () => this.#persistRegistry(),
    });
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
    this.#projects =
      options.projectRegistry ??
      (options.projectRegistryFilePath
        ? new PersistentProjectRegistry({
            filePath: options.projectRegistryFilePath,
            ...(options.log ? { log: options.log } : {}),
          })
        : new ProjectRegistry());
    this.#evidence = options.evidenceStore ?? null;
    this.#profile = loadCompatibilityProfile(options.repoRoot, options.profileId);
    assertProfileUsable(this.#profile, 'prototype');
    this.#permissionAdapter = new PermissionAdapter({
      provider: 'native',
      bridgeClient: {
        action: async (operation, _args) => {
          this.#log('DEBUG', 'permission.action', { operation });
          return {};
        },
        query: async (operation, args) => {
          this.#log('DEBUG', 'permission.query', { operation });
          return { player: args['player'], permission: args['permission'], hasPermission: false, source: 'default' };
        },
      },
    });
    this.#fixtureManifest = loadFixtureManifest(
      options.fixtureManifestPath ?? join(options.repoRoot, 'fixtures', 'manifests', 'flat-world-v1.yaml'),
    );
    this.#garbageCollector.start();
  }

  #log(level: string, event: string, fields: Record<string, unknown> = {}): void {
    this.#options.log?.(level, event, fields);
  }

  /** Java tespiti maliyetlidir; ilk ihtiyaçta yapılır ve önbelleklenir. */
  async #javaInstallation(): Promise<JavaInstallation> {
    this.#java ??= await resolveJavaForProfile(this.#profile.java.runtime_major);
    return this.#java;
  }

  /** Registry'yi ilk kullanımda disk'ten yükler (yalnızca persistent modda). */
  #ensureRegistryLoaded(): Promise<void> {
    this.#registryLoaded ??=
      this.#registry instanceof PersistentRuntimeRegistry
        ? this.#registry.load()
        : Promise.resolve();
    return this.#registryLoaded;
  }

  /** Durum değişimlerini disk'e yazar (yalnızca persistent modda). */
  async #persistRegistry(): Promise<void> {
    if (this.#registry instanceof PersistentRuntimeRegistry) {
      try {
        await this.#registry.save();
      } catch (err) {
        this.#log('WARN', 'persistent_registry.save_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** Proje registry'yi ilk kullanımda disk'ten yükler (yalnızca persistent modda). */
  #ensureProjectsLoaded(): Promise<void> {
    this.#projectsLoaded ??=
      this.#projects instanceof PersistentProjectRegistry
        ? this.#projects.load()
        : Promise.resolve();
    return this.#projectsLoaded;
  }

  /** Container build backend'ini tembel oluşturur (Docker erişimi gerektirmez). */
  #containerExecutionBackend(): ContainerExecutionBackend {
    this.#containerExecution ??=
      this.#options.containerExecutionBackend ??
      new ContainerExecutionBackend({
        image: `eclipse-temurin:${this.#profile.java.runtime_major}-jdk`,
        ...(this.#options.log ? { log: this.#options.log } : {}),
      });
    return this.#containerExecution;
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
      'project.list': (params) => this.projectList(params as ProjectListParams),
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
      'permission.attach': (params) => this.permissionAttach(params as PermissionAttachParams),
      'permission.detach': (params) => this.permissionDetach(params as PermissionDetachParams),
      'permission.check': (params) => this.permissionCheck(params as PermissionCheckParams),
      'permission.set_op': (params) => this.permissionSetOp(params as PermissionSetOpParams),
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
    await this.#ensureRegistryLoaded();
    this.#registry.assertQuota();

    const resolved = await resolveBuild(this.#profile, globalThis.fetch);
    const jar = await downloadPaperJar(resolved, this.#options.paperCacheDir, globalThis.fetch);

    const serverInstanceId = `srv_${randomBytes(12).toString('hex')}`;
    const runtimeRoot = join(this.#options.runtimeRootDir, serverInstanceId);

    // Tool yüzeyi mutlak path kabul etmez (FS-03): hedef plugin yalnızca build
    // kaydından çözümlenir ve sha256 yeniden doğrulanır.
    const targetPluginPaths: string[] = [...(params?.targetPluginPaths ?? [])];
    if (params?.buildId) {
      const artifact = await this.#builds.resolveArtifact(params.buildId);
      targetPluginPaths.push(artifact.path);
    }

    const image = await createRuntimeImage({
      runtimeRoot,
      serverInstanceId,
      paperJarPath: jar.path,
      bridgeJarPath: this.#options.bridgeJarPath,
      profile: this.#profile,
      acceptMinecraftEula: params?.acceptMinecraftEula === true,
      ...(params?.determinism ? { determinism: params.determinism } : {}),
      ...(targetPluginPaths.length > 0 ? { targetPluginPaths } : {}),
      ...(this.#fixtureManifest ? { fixtureManifest: this.#fixtureManifest } : {}),
    });

    const entry = this.#registry.register(image);
    await this.#persistRegistry();
    this.#log('INFO', 'runtime.created', {
      runtime_image_id: image.runtimeImageId,
      server_instance_id: serverInstanceId,
      paper_jar_sha256: image.paperJarSha256,
      ...(params?.buildId ? { build_id: params.buildId } : {}),
    });
    return this.#registry.summarize(entry);
  }

  async launchRuntime(params: RuntimeIdParams): Promise<RuntimeSummary> {
    await this.#ensureRegistryLoaded();
    const entry = this.#registry.requireState(params.runtimeImageId, ['CREATED']);
    const java = await this.#javaInstallation();

    this.#registry.updateState(entry, 'STARTING');
    entry.launchError = null;
    const startedAt = Date.now();
    try {
      const running = await launchPaper({ image: entry.image, javaExecutable: java.executable });
      entry.running = running;
      entry.readyGateMs = Date.now() - startedAt;
      this.#registry.updateState(entry, 'READY');
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

      await this.#persistRegistry();
      this.#log('INFO', 'runtime.ready', {
        runtime_image_id: entry.image.runtimeImageId,
        bridge_boot_id: running.handshake.bridge_boot_id,
        duration_ms: entry.readyGateMs,
      });
    } catch (err) {
      entry.launchError = err instanceof Error ? err.message : String(err);
      this.#registry.updateState(entry, 'CRASHED');
      await this.#persistRegistry();
      this.#log('ERROR', 'runtime.launch_failed', {
        runtime_image_id: entry.image.runtimeImageId,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    return this.#registry.summarize(entry);
  }

  async getRuntime(params: RuntimeIdParams): Promise<RuntimeSummary> {
    await this.#ensureRegistryLoaded();
    return this.#registry.summarize(this.#registry.get(params.runtimeImageId));
  }

  async stopRuntime(params: RuntimeIdParams): Promise<CleanupEvidence> {
    await this.#ensureRegistryLoaded();
    const entry = this.#registry.requireState(params.runtimeImageId, ['READY', 'STARTING']);
    if (!entry.running) {
      this.#registry.updateState(entry, 'STOPPED');
      throw Object.assign(new Error('Runtime çalışmıyor.'), { code: 'RUNTIME_NOT_RUNNING' });
    }

    this.#registry.updateState(entry, 'STOPPING');
    const cleanup = await stopPaper(entry.running);
    this.#registry.updateState(entry, 'STOPPED');
    entry.running = null;
    await this.#persistRegistry();

    this.#log(cleanup.forceTerminated ? 'WARN' : 'INFO', 'runtime.stopped', {
      runtime_image_id: entry.image.runtimeImageId,
      graceful: cleanup.graceful,
      force_terminated: cleanup.forceTerminated,
      port_released: cleanup.portReleased,
    });

    return cleanup;
  }

  /**
   * Release, SİLME değildir: runtime RELEASED durumuna geçer; Garbage
   * Collector retention süresi sonunda dizini siler (state-machines.md:
   * RETENTION → DELETE_VALIDATION → DELETING → DELETED).
   *
   * `discardImmediately` yalnızca smoke akışının kendi artığını toplaması
   * içindir; normal akışta kullanılmaz.
   */
  async releaseRuntime(params: RuntimeIdParams & { discardImmediately?: boolean }): Promise<RuntimeSummary> {
    await this.#ensureRegistryLoaded();
    const entry = this.#registry.requireState(params.runtimeImageId, ['STOPPED', 'CRASHED']);
    this.#registry.updateState(entry, 'RELEASED');

    if (params.discardImmediately === true) {
      await rm(entry.image.runtimeRoot, { recursive: true, force: true });
    }

    await this.#persistRegistry();
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
    await this.#ensureRegistryLoaded();
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
    await this.#ensureRegistryLoaded();
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

  // ─── Permission handler'ları ───────────────────────────────────────

  async permissionAttach(params: PermissionAttachParams): Promise<PermissionAttachResult> {
    const attachment = await this.#permissionAdapter.attachPermission(
      params.player,
      params.permission,
      params.value ?? true,
      params.durationMs,
    );
    return {
      attachmentId: attachment.attachmentId,
      playerName: attachment.playerName,
      permission: attachment.permission,
      value: attachment.value,
      createdAt: attachment.createdAt,
      expiresAt: attachment.expiresAt,
    };
  }

  async permissionDetach(params: PermissionDetachParams): Promise<PermissionDetachResult> {
    await this.#permissionAdapter.detachPermission(params.attachmentId);
    return { success: true };
  }

  async permissionCheck(params: PermissionCheckParams): Promise<PermissionCheckResult> {
    return this.#permissionAdapter.checkPermission(params.player, params.permission);
  }

  async permissionSetOp(params: PermissionSetOpParams): Promise<PermissionSetOpResult> {
    await this.#permissionAdapter.setOp(params.player, params.value);
    return { success: true };
  }

  // ─── Yeni IPC handler'ları ──────────────────────────────────────────

  async projectInspect(params: ProjectInspectParams): Promise<ProjectInspectResult> {
    await this.#ensureProjectsLoaded();
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
    await this.#ensureProjectsLoaded();
    const project = this.#projects.get(params.projectId);

    const validation = await validateGradleProject(project.canonicalRoot, {
      distributionHostAllowlist: ['services.gradle.org'],
      expectedVersion: this.#profile.gradle?.wrapper_version ?? '',
      expectedDistributionSha256: this.#profile.gradle?.distribution_sha256 ?? null,
      knownWrapperJarSha256: this.#profile.gradle?.wrapper_jar_sha256 ? [this.#profile.gradle.wrapper_jar_sha256] : [],
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

  /**
   * Proje kaydı launcher config/CLI yüzeyindendir (main.ts --project-id/
   * --project-root; P0-7 serve). IPC'de kayıt metodu yoktur: mutation +
   * project scope R3'tür ve ADR-0007 gereği hiçbir profilde agent
   * yüzeyine çıkmaz. Kalıcılık (--registry-file) launcher kaydını diskte
   * tutar.
   */
  async projectList(params: ProjectListParams): Promise<ProjectListResult> {
    await this.#ensureProjectsLoaded();

    const projects =
      params.projectId !== undefined
        ? [this.#projects.get(params.projectId)]
        : this.#projects.list();

    return {
      projects: projects.map((project) => ({
        projectId: project.id,
        rootPath: project.canonicalRoot,
        trustLevel: project.trustLevel,
        allowedBackends: project.allowedBackends,
        defaultBackend: project.defaultBackend,
      })),
    };
  }

  async buildRun(params: BuildRunParams): Promise<BuildRunResult> {
    await this.#ensureRegistryLoaded();
    await this.#ensureProjectsLoaded();
    this.#projects.assertBuildAllowed(params.projectId);

    const requestedBackend = params.backend ?? 'trusted-local';
    let containerBackend: ContainerExecutionBackend | undefined;
    if (requestedBackend === 'container') {
      const candidate = this.#containerExecutionBackend();
      // Docker yoksa executor'a backend bağlanmaz; BACKEND_UNAVAILABLE döner.
      const availability = await candidate.getAvailability();
      if (availability.available) {
        containerBackend = candidate;
      } else {
        this.#log('WARN', 'build.container_unavailable', {
          project_id: params.projectId,
          reason: availability.reason,
        });
      }
    }

    const { BuildExecutor } = await import('./build-executor.js');
    const executor = new BuildExecutor({
      registry: this.#projects,
      gradleValidation: {
        distributionHostAllowlist: ['services.gradle.org'],
        expectedVersion: this.#profile.gradle?.wrapper_version ?? '',
        expectedDistributionSha256: this.#profile.gradle?.distribution_sha256 ?? null,
        knownWrapperJarSha256: this.#profile.gradle?.wrapper_jar_sha256 ? [this.#profile.gradle.wrapper_jar_sha256] : [],
        requireLockAndVerification: true,
      },
      javaMajor: this.#profile.java.runtime_major,
      artifactStoreDir: this.#options.artifactStoreDir ?? join(this.#options.repoRoot, '.mcpdev-data', 'artifacts'),
      ...(this.#options.dependencyCacheDir ? { dependencyCacheDir: this.#options.dependencyCacheDir } : {}),
      ...(containerBackend ? { container: containerBackend } : {}),
      ...(this.#evidence ? { evidence: this.#evidence } : {}),
      ...(this.#options.log ? { log: this.#options.log } : {}),
    });

    const outcome = await executor.execute({
      projectId: params.projectId,
      mode: params.mode,
      backend: requestedBackend,
      network: params.network === 'online' ? 'repository-allowlist' : 'offline',
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
    });

    // Build kaydı: plugin_launch build_id ile artifact'i buradan çözer.
    this.#builds.record({
      buildId: outcome.runId,
      projectId: params.projectId,
      mode: params.mode,
      backend: requestedBackend,
      status: outcome.ok ? 'completed' : 'failed',
      artifactPath: outcome.artifact?.absolutePath ?? null,
      artifactSha256: outcome.artifact?.sha256 ?? null,
      artifactRelativePath: outcome.artifact?.path ?? null,
      evidenceIds: outcome.provenance?.evidenceIds ?? [],
      durationMs: outcome.run?.durationMs ?? 0,
      createdAt: new Date().toISOString(),
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
    if (params.buildId) {
      const record = this.#builds.get(params.buildId);
      if (!record) {
        return {
          type: 'build',
          summary: `Build kaydı bulunamadı: ${params.buildId}.`,
          errors: [],
          failedTasks: [],
          warnings: [],
        };
      }

      if (this.#evidence) {
        // Build kanıtları: id'ler rastgele üretilir (ev_<hex>); compiler
        // diagnostics kanıtı, build'in döndürdüğü gerçek evidenceIds üzerinden
        // manifest kind'ına göre bulunur.
        let diagnosticsId: string | null = null;
        for (const id of record.evidenceIds) {
          try {
            const manifest = await this.#evidence.getManifest(id);
            if (manifest.kind === 'compiler-diagnostics') {
              diagnosticsId = id;
              break;
            }
          } catch {
            // Kayıtları atla; kanıt silinmiş olabilir.
          }
        }
        if (diagnosticsId) {
          try {
            const { text } = await this.#evidence.get(diagnosticsId, 1024 * 1024);
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
              summary: `Build teşhisi (${record.backend}): ${parsed.errors?.length ?? 0} hata, ${parsed.warnings?.length ?? 0} uyarı`,
              errors: (parsed.errors ?? []).map((e) => ({
                ...e,
                severity: 'error' as const,
              })),
              failedTasks: parsed.failedTasks ?? [],
              warnings: parsed.warnings ?? [],
            };
          } catch {
            // Kanıt okunamadıysa aşağıdaki genel özet döner.
          }
        }
      }

      return {
        type: 'build',
        summary:
          record.status === 'completed'
            ? `Build tamamlandı; artifact: ${record.artifactRelativePath ?? 'yok'}.`
            : `Build başarısız (${record.backend}); ${record.evidenceIds.length} kanıt üretildi.`,
        errors: [],
        failedTasks: [],
        warnings: [],
      };
    }

    if (params.runtimeId) {
      // Runtime teşhisi: durum makinesi + son launch hatası + ready gate.
      try {
        const entry = this.#registry.get(params.runtimeId);
        const errors: PluginDiagnoseResult['errors'] = [];
        const warnings: PluginDiagnoseResult['warnings'] = [];

        if (entry.launchError) {
          errors.push({
            file: '(runtime)',
            line: null,
            column: null,
            severity: 'error',
            message: entry.launchError,
            symbol: null,
            suggestedAction: 'evidence_get ile runtime loglarını inceleyin; EULA/checksum/ready gate hatalarını ayırt edin.',
          });
        } else if (entry.state === 'CRASHED') {
          errors.push({
            file: '(runtime)',
            line: null,
            column: null,
            severity: 'error',
            message: 'Paper process beklenmedik biçimde sonlandı.',
            symbol: null,
            suggestedAction: 'evidence_get ile runtime loglarını ve crash kanıtını inceleyin.',
          });
        }

        if (entry.readyGateMs === null && entry.state !== 'CREATED') {
          warnings.push({
            file: '(runtime)',
            line: null,
            message: `Ready gate hiç geçilmedi (durum: ${entry.state}).`,
          });
        }
        if (entry.running) {
          warnings.push({
            file: '(runtime)',
            line: null,
            message: `Runtime ayakta; bridge port ${entry.running.handshake.port}.`,
          });
        }

        return {
          type: 'runtime',
          summary:
            errors.length > 0
              ? `Runtime teşhisi: ${errors.length} hata (durum: ${entry.state}).`
              : `Runtime teşhisi: sorun yok (durum: ${entry.state}, ready_gate_ms: ${entry.readyGateMs ?? 'yok'}).`,
          errors,
          failedTasks: [],
          warnings,
        };
      } catch {
        return {
          type: 'runtime',
          summary: `Runtime kaydı bulunamadı: ${params.runtimeId}.`,
          errors: [],
          failedTasks: [],
          warnings: [],
        };
      }
    }

    return {
      type: 'build',
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
      accept_minecraft_eula: params.acceptMinecraftEula,
      ...(params.buildId ? { build_id: params.buildId } : {}),
    });

    // Scenario engine'i oluştur.
    //
    // determinism.md DSL-11: her scenario kendi disposable runtime'ında koşar;
    // runtimeProvider her çağrıda yeni bir runtime hazırlar ve engine run()
    // bittiğinde dispose() ile temiz kapatır (stop + release).
    const engineOptions: ScenarioEngineOptions = {
      repoRoot: this.#options.repoRoot,
      scenarioPath: params.scenarioPath,
      projectId: params.projectId,
      runtimeProvider: async () => {
        const summary = await this.createRuntime({
          acceptMinecraftEula: params.acceptMinecraftEula,
          ...(params.buildId ? { buildId: params.buildId } : {}),
        });
        await this.launchRuntime({ runtimeImageId: summary.runtimeImageId });

        const entry = this.#registry.get(summary.runtimeImageId);
        if (!entry.running) {
          throw Object.assign(new Error('Scenario runtime READY durumuna gelemedi.'), {
            code: 'RUNTIME_NOT_RUNNING',
          });
        }

        const running = entry.running;
        return {
          runtimeImageId: summary.runtimeImageId,
          bridgeBootId: running.handshake.bridge_boot_id,
          bridgeClient: running.client,
          dispose: async () => {
            // Cleanup kanıtı ayrı raporlanır (milestone-acceptance.md):
            // stopPaper'ın temizlik kaydı döner; runtime RELEASED'a geçer.
            if (entry.running) {
              await stopPaper(entry.running, 10_000).catch(() => undefined);
              entry.running = null;
              this.#registry.updateState(entry, 'STOPPED');
            } else if (entry.state === 'CREATED' || entry.state === 'STARTING') {
              // Launch'a ulaşamayan runtime: doğrudan STOPPED'a alınır ki
              // release yapılabilsin (quota serbest kalır).
              this.#registry.updateState(entry, 'STOPPED');
            }
            await this.releaseRuntime({
              runtimeImageId: summary.runtimeImageId,
              discardImmediately: true,
            }).catch(() => undefined);
          },
        };
      },
      getActorClient: (runtimeImageId: string) => {
        const entry = this.#registry.get(runtimeImageId);
        if (!entry.running) {
          return null;
        }
        // Actor komutları bridge /v1/action ucu üzerinden çalışır; idempotency
        // anahtarı action gövdesi mutation ledger'a bırakılır (idempotency key
        // adım başına üretilir, replay koruması için).
        return new ActorClient(async (operation, args) => {
          const result = await entry.running!.client.action(operation, args, randomBytes(16).toString('hex'));
          return result as Record<string, unknown>;
        });
      },
      version: this.#options.version,
      log: this.#log.bind(this),
    };

    if (this.#evidence) {
      (engineOptions as { evidenceStore: ScenarioEngineOptions['evidenceStore'] }).evidenceStore = this.#evidence as unknown as ScenarioEngineOptions['evidenceStore'];
    }

    const engine = new ScenarioEngine(engineOptions);

    // Scenario'yi çalıştır
    try {
      return await engine.run();
    } finally {
      // Runtime run() sırasında sağlandıysa temiz kapat (DSL-11).
      await engine.disposeRuntime().catch(() => undefined);
    }
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
    this.#garbageCollector.stop();
    for (const entry of this.#registry.list()) {
      if (entry.running) {
        await stopPaper(entry.running, 10_000).catch(() => undefined);
        entry.running = null;
        this.#registry.updateState(entry, 'STOPPED');
      }
    }
    await this.#persistRegistry();
  }
}

/**
 * Fixture manifest'ini YAML olarak okur. Dosya yoksa veya parse edilemezse
 * null döner — dünya mutation'ları manifest'sız runtime'larda devre dışı kalır.
 */
function loadFixtureManifest(path: string): Readonly<Record<string, unknown>> | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}
