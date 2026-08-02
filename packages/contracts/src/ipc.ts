/**
 * MCP Server ↔ Run Supervisor arası yerel IPC sözleşmesi.
 *
 * ADR-0003: Supervisor **bağımsız** bir process'tir. MCP Server ona bağlanır;
 * onu child process olarak doğurmaz. Aksi hâlde MCP Server'ın ölmesi Paper
 * process sahipliğini de düşürürdü — ADR'nin var oluş nedeni tam olarak budur.
 *
 * Taşıma:
 *   - Windows: named pipe (`\\.\pipe\...`)
 *   - POSIX  : unix domain socket (dosya izinleriyle korunur)
 *
 * Çerçeveleme: satır sonlandırmalı JSON. Mesaj başına sert boyut sınırı vardır;
 * sınırsız bir tampon, tek bir bozuk yazıcının Supervisor'ın belleğini
 * tüketmesine izin verirdi.
 */

/** Tek bir IPC isteği. */
export interface IpcRequest<TParams = unknown> {
  readonly v: 1;
  readonly id: string;
  readonly method: IpcMethod;
  readonly params: TParams;
}

/** Tek bir IPC yanıtı. `ok` alanı union'ı ayırır. */
export type IpcResponse<TResult = unknown> =
  | { readonly v: 1; readonly id: string; readonly ok: true; readonly result: TResult }
  | { readonly v: 1; readonly id: string; readonly ok: false; readonly error: IpcError };

export interface IpcError {
  /** Error catalog kodu. */
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly suggested_action: string;
}

/**
 * Desteklenen metotlar.
 *
 * Bilinçli olarak dar: Supervisor'a genel amaçlı bir "çalıştır" yüzeyi
 * açılmaz. Her metot tipli parametre alır; serbest komut yoktur.
 */
export type IpcMethod =
  | 'supervisor.health'
  | 'runtime.create'
  | 'runtime.launch'
  | 'runtime.get'
  | 'runtime.stop'
  | 'runtime.release'
  | 'bridge.query'
  | 'bridge.events'
  | 'events.subscribe'
  | 'events.unsubscribe'
  | 'events.list'
  | 'project.inspect'
  | 'project.validate'
  | 'build.run'
  | 'plugin.diagnose'
  | 'scenario.run'
  | 'evidence.get'
  | 'pool.status'
  | 'pool.acquire'
  | 'pool.release'
  | 'pool.evict'
  | 'pool.list'
  | 'pool.reset'
  | 'profile.list'
  | 'profile.get';

export interface SupervisorHealthResult {
  readonly status: 'ok';
  readonly version: string;
  readonly pid: number;
  readonly node: string;
  readonly uptimeMs: number;
  readonly compatibilityProfile: string;
  readonly profileVerification: string;
  readonly runtimeCount: number;
  readonly javaMajor: number | null;
}

export interface RuntimeCreateParams {
  readonly acceptMinecraftEula: boolean;
  readonly targetPluginPaths?: readonly string[];
}

export interface RuntimeSummary {
  readonly runtimeImageId: string;
  readonly serverInstanceId: string;
  readonly state: RuntimeIpcState;
  readonly bridgeBootId: string | null;
  readonly bridgePort: number | null;
  readonly paperJarSha256: string;
  readonly bridgeJarSha256: string;
  readonly createdAt: string;
  readonly readyGateMs: number | null;
}

export type RuntimeIpcState =
  | 'CREATED'
  | 'STARTING'
  | 'READY'
  | 'STOPPING'
  | 'STOPPED'
  | 'CRASHED'
  | 'RELEASED';

export interface RuntimeIdParams {
  readonly runtimeImageId: string;
}

export interface BridgeQueryParams extends RuntimeIdParams {
  readonly operation: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
}

export interface BridgeEventsParams extends RuntimeIdParams {
  readonly bootId: string;
  readonly after?: number;
  readonly limit?: number;
}

export interface CleanupEvidence {
  readonly graceful: boolean;
  readonly forceTerminated: boolean;
  readonly exitCode: number | null;
  readonly portReleased: boolean;
  readonly handshakeRemoved: boolean;
  readonly durationMs: number;
}

/** Mesaj başına sert üst sınır. */
export const IPC_MAX_MESSAGE_BYTES = 1_048_576;

/** İstek başına varsayılan üst süre. */
export const IPC_DEFAULT_TIMEOUT_MS = 30_000;

/** Uzun süren runtime işlemleri için ayrı üst süre. */
export const IPC_LAUNCH_TIMEOUT_MS = 300_000;

// ─── Yeni IPC method tipleri ────────────────────────────────────────────

export interface ProjectInspectParams {
  readonly projectId: string;
}

export interface ProjectInspectResult {
  readonly projectId: string;
  readonly rootPath: string;
  readonly trustLevel: string;
  readonly gradleWrapper: {
    readonly found: boolean;
    readonly jarExists: boolean;
    readonly propertiesExists: boolean;
  };
  readonly pluginMetadata: {
    readonly found: boolean;
    readonly name?: string;
    readonly version?: string;
    readonly mainClass?: string;
    readonly apiVersion?: string;
  } | null;
  readonly testContract: {
    readonly found: boolean;
  } | null;
}

export interface ProjectValidateParams {
  readonly projectId: string;
}

export interface ValidationFinding {
  readonly severity: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  readonly suggestedAction: string;
}

export interface ProjectValidateResult {
  readonly projectId: string;
  readonly findings: readonly ValidationFinding[];
  readonly gradleVersion: string | null;
  readonly javaMajor: number | null;
  readonly distributionSha256Valid: boolean | null;
  readonly lockFilePresent: boolean;
  readonly verificationMetadataPresent: boolean;
}

export interface BuildRunParams {
  readonly projectId: string;
  readonly mode: 'build' | 'unit_test' | 'integration_test' | 'clean_build';
  readonly network?: 'online' | 'offline';
  readonly timeoutMs?: number;
}

export interface BuildRunResult {
  readonly buildId: string;
  readonly projectId: string;
  readonly mode: string;
  readonly status: 'completed' | 'failed';
  readonly artifact?: {
    id: string;
    path: string;
    sha256: string;
    byteSize: number;
  };
  readonly durationMs: number;
  readonly evidenceIds: readonly string[];
  readonly diagnostics?: {
    errors: Array<{
      file: string;
      line: number;
      message: string;
      suggestedAction: string;
    }>;
    warnings: Array<{
      file: string;
      line: number;
      message: string;
    }>;
    failedTasks: readonly string[];
  };
}

export interface PluginDiagnoseParams {
  readonly runtimeId?: string;
  readonly buildId?: string;
}

export interface PluginDiagnoseResult {
  readonly type: 'build' | 'runtime';
  readonly summary: string;
  readonly errors: Array<{
    file: string;
    line: number | null;
    column: number | null;
    severity: 'error' | 'warning';
    message: string;
    symbol: string | null;
    suggestedAction: string;
  }>;
  readonly failedTasks: readonly string[];
  readonly warnings: Array<{
    file: string;
    line: number | null;
    message: string;
  }>;
}

export interface ScenarioRunParams {
  readonly scenarioPath: string;
  readonly projectId: string;
}

export interface ScenarioRunResult {
  readonly scenarioRunId: string;
  readonly status: 'completed' | 'failed' | 'timed_out';
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly durationMs: number;
  readonly evidenceIds: readonly string[];
}

export interface EvidenceGetParams {
  readonly evidenceId: string;
  readonly runId?: string;
}

export interface EvidenceGetResult {
  readonly evidenceId: string;
  readonly kind: string;
  readonly producer: { component: string; version: string };
  readonly content: unknown;
  readonly byteSize: number;
  readonly checksum: string;
  readonly createdAt: string;
}

// ─── Event subscription types ─────────────────────────────────────────

export interface EventSubscribeParams {
  readonly runtimeId: string;
  readonly bootId: string;
  readonly filter?: EventFilter;
  readonly maxEvents?: number;
}

export interface EventFilter {
  readonly types?: readonly string[];
  readonly actor?: string;
  readonly excludeTypes?: readonly string[];
}

export interface EventSubscribeResult {
  readonly subscriptionId: string;
  readonly status: 'active' | 'expired' | 'unsubscribed';
  readonly eventsReceived: number;
}

export interface EventUnsubscribeParams {
  readonly subscriptionId: string;
}

export interface EventUnsubscribeResult {
  readonly subscriptionId: string;
  readonly status: 'unsubscribed';
  readonly eventsReceived: number;
}

export interface EventListParams {
  readonly subscriptionId: string;
  readonly after?: number;
  readonly limit?: number;
}

export interface EventListResult {
  readonly subscriptionId: string;
  readonly events: readonly EventRecord[];
  readonly hasMore: boolean;
  readonly nextCursor: number | null;
}

export interface EventRecord {
  readonly sequence: number;
  readonly eventId: string;
  readonly type: string;
  readonly runId: string | null;
  readonly serverInstanceId: string;
  readonly bridgeBootId: string;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly serverTick: number;
  readonly occurredAt: string;
  readonly actor: string | null;
  readonly data: Record<string, unknown>;
  readonly source: string;
}

/** Event subscription error codes */
export const EVENT_ERROR_CODES = {
  SUBSCRIPTION_NOT_FOUND: 'EVENT_SUBSCRIPTION_NOT_FOUND',
  SUBSCRIPTION_EXPIRED: 'EVENT_SUBSCRIPTION_EXPIRED',
  RUNTIME_NOT_RUNNING: 'RUNTIME_NOT_RUNNING',
  INVALID_FILTER: 'EVENT_INVALID_FILTER',
  MAX_SUBSCRIPTIONS_EXCEEDED: 'EVENT_MAX_SUBSCRIPTIONS_EXCEEDED',
} as const;

/** Maximum concurrent subscriptions per runtime */
export const MAX_SUBSCRIPTIONS_PER_RUNTIME = 10;

/** Default subscription TTL (5 minutes) */
export const SUBSCRIPTION_TTL_MS = 300_000;

/** Maximum events to buffer per subscription */
export const MAX_EVENTS_PER_SUBSCRIPTION = 10_000;

// ============================================================================
// Runtime Pool IPC
// ============================================================================

/** Runtime pool status */
export interface PoolStatusResult {
  readonly total: number;
  readonly idle: number;
  readonly acquired: number;
  readonly evicted: number;
  readonly expired: number;
  readonly maxPoolSize: number;
  readonly maxIdleMs: number;
  readonly maxReuseCount: number;
}

/** Pool entry for list operations */
export interface PoolEntryInfo {
  readonly poolId: string;
  readonly runtimeImageId: string;
  readonly runtimeId: string;
  readonly bootId: string;
  readonly state: 'IDLE' | 'ACQUIRED' | 'EVICTED' | 'EXPIRED';
  readonly reuseCount: number;
  readonly acquiredAt: number;
  readonly lastActivityAt: number;
  readonly createdAt: number;
}

/** Pool status query params */
export interface PoolStatusParams {}

/** Pool acquire params */
export interface PoolAcquireParams {
  readonly runtimeImageId: string;
  readonly runtimeId: string;
  readonly bootId: string;
}

/** Pool acquire result */
export interface PoolAcquireResult {
  readonly poolId: string;
  readonly reuseCount: number;
  readonly reused: boolean;
}

/** Pool release params */
export interface PoolReleaseParams {
  readonly poolId: string;
}

/** Pool release result */
export interface PoolReleaseResult {
  readonly state: string;
  readonly evicted: boolean;
}

/** Pool evict params */
export interface PoolEvictParams {
  readonly poolId: string;
}

/** Pool evict result */
export interface PoolEvictResult {
  readonly evicted: boolean;
}

/** Pool list params */
export interface PoolListParams {
  readonly runtimeImageId?: string;
}

/** Pool list result */
export interface PoolListResult {
  readonly entries: PoolEntryInfo[];
  readonly total: number;
}

/** Pool reset params */
export interface PoolResetParams {}

/** Pool reset result */
export interface PoolResetResult {
  readonly evicted: number;
}

// ============================================================================
// Profile IPC
// ============================================================================

/** Profile list params */
export interface ProfileListParams {}

/** Profile list result */
export interface ProfileListResult {
  readonly profiles: Array<{
    readonly id: string;
    readonly status: string;
    readonly minecraftVersion: string;
    readonly paperBuild: number;
    readonly verificationStatus: string;
  }>;
  readonly activeProfileId: string;
}

/** Profile get params */
export interface ProfileGetParams {
  readonly profileId: string;
}

/** Profile get result */
export interface ProfileGetResult {
  readonly id: string;
  readonly status: string;
  readonly minecraftVersion: string;
  readonly paperBuild: number;
  readonly verificationStatus: string;
  readonly javaVersion: number;
  readonly nodeVersion: string;
  readonly gradleVersion: string;
}
