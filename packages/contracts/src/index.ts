// Paylaşılan sözleşme tipleri.
//
// Şema dosyaları (packages/contracts/schemas/) normatif kaynaktır; buradaki
// tipler onların TypeScript karşılığıdır. Uyuşmazlık contract testiyle
// yakalanır (CT-MCP-SCHEMA-001).

export * from './ipc.js';
export * from './ndjson.js';
export * from './endpoint.js';

/** docs/contracts/mcp.md — success/error union. */
export type ToolStructuredContent<TData = unknown> =
  | {
      readonly status: 'success';
      readonly correlation_id: string;
      readonly data: TData;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'error';
      readonly correlation_id: string;
      readonly error: ToolError;
    };

export interface ToolError {
  readonly code: string;
  readonly retryable: boolean;
  /** KPI-08: her hata önerilen aksiyon taşır. */
  readonly suggested_action: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly terminal_state?: TerminalRunState;
}

export type TerminalRunState =
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT'
  | 'DIRTY'
  | 'ORPHANED'
  | 'UNKNOWN_OUTCOME';

export type RunState =
  | 'CREATED'
  | 'SNAPSHOTTING_SOURCE'
  | 'PREPARING_BUILD'
  | 'BUILDING'
  | 'PREPARING_RUNTIME'
  | 'STARTING_RUNTIME'
  | 'READY'
  | 'EXECUTING_SCENARIO'
  | 'COLLECTING_EVIDENCE'
  | 'CLEANING_UP'
  | 'COMPLETED'
  | TerminalRunState;

export type RuntimeState =
  | 'NEW'
  | 'CREATING'
  | 'CREATED'
  | 'STARTING'
  | 'READY'
  | 'STOPPING'
  | 'STOPPED'
  | 'FORCE_STOPPING'
  | 'FORCE_STOPPED'
  | 'CRASHED'
  | 'FAILED'
  | 'RELEASED'
  | 'RETENTION'
  | 'DELETE_VALIDATION'
  | 'DELETING'
  | 'DELETED';

export type OperationState =
  | 'CREATED'
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'CANCELLING'
  | 'CANCELLED';

export type MutationState =
  | 'RECEIVED'
  | 'VALIDATED'
  | 'SCHEDULED'
  | 'APPLYING'
  | 'APPLIED'
  | 'FAILED'
  | 'UNKNOWN_OUTCOME';

export type TrustLevel =
  | 'untrusted'
  | 'developer-workspace'
  | 'pinned-source'
  | 'approved-fixture'
  | 'revoked';

export type ExecutionBackendKind = 'trusted-local' | 'container';

/**
 * ADR-0004: runtime_backend.security_level >= build_backend.security_level.
 * Sayı büyüdükçe izolasyon güçlenir.
 */
export const BACKEND_SECURITY_LEVEL: Readonly<Record<ExecutionBackendKind, number>> = {
  'trusted-local': 1,
  container: 2,
};

/** docs/contracts/bridge.md */
export interface BridgeRequest {
  readonly request_id: string;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly run_id: string;
  readonly server_instance_id: string;
  readonly bridge_boot_id: string;
  readonly operation: string;
  /** Mutation operation'ları için zorunlu; read-only için null. */
  readonly idempotency_key: string | null;
  readonly timeout_ms: number;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface BridgeResponse<TData = unknown> {
  readonly request_id: string;
  readonly correlation_id: string;
  readonly ok: boolean;
  readonly server_instance_id: string;
  readonly bridge_boot_id: string;
  readonly server_tick: number;
  readonly data?: TData;
  readonly error?: ToolError;
  readonly warnings: readonly string[];
}

/** Event cursor üçlüsü — boot ayrımı zorunludur. */
export interface EventCursor {
  readonly server_instance_id: string;
  readonly bridge_boot_id: string;
  readonly sequence: number;
}

/** docs/contracts/evidence.md — provenance zinciri. */
export interface ProvenanceChain {
  readonly source_snapshot_id: string;
  readonly execution_environment_id: string;
  readonly build_artifact_id: string;
  readonly runtime_image_id: string;
  readonly server_instance_id: string;
  readonly scenario_run_id: string;
  readonly evidence_ids: readonly string[];
  readonly report_id: string;
}
