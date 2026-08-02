/**
 * Evidence ve report modeli — docs/contracts/evidence.md.
 *
 * Bu paketin tek işi, provenance zincirinin eksiksizliğini TİP DÜZEYİNDE
 * zorunlu kılmaktır. Zincirin bir halkası eksikse rapor derlenmez; KPI-09
 * çalışma zamanına bırakılmaz.
 */

import type { ProvenanceChain } from '@mcpdev/contracts';

export * from './store.js';

export type EvidenceKind =
  | 'build-log'
  | 'compiler-diagnostics'
  | 'artifact-manifest'
  | 'runtime-log'
  | 'plugin-state'
  | 'ready-gate-proof'
  | 'event-log'
  | 'assertion-result'
  | 'block-observation'
  | 'actor-transcript'
  | 'mcp-transcript'
  | 'cleanup-result'
  | 'port-release-proof'
  | 'process-tree-proof'
  | 'source-snapshot'
  | 'project-manifest'
  | 'report-manifest'
  | 'doc-audit';

export type RedactionProfile = 'none' | 'default-v1' | 'strict-v1';

export interface EvidenceProducer {
  readonly component: 'mcp-server' | 'run-supervisor' | 'paper-bridge' | 'protocol-test-actor';
  readonly version: string;
  readonly serverInstanceId?: string;
  readonly bridgeBootId?: string;
}

export interface EvidenceManifest {
  readonly evidenceId: string;
  readonly runId: string;
  readonly scenarioRunId: string | null;
  readonly kind: EvidenceKind;
  /**
   * Zorunlu: aynı kind altındaki bir kanıtın Bridge tarafından mı Supervisor
   * tarafından mı üretildiği, same-JVM limitation'ı değerlendirmek için
   * gereklidir (ADR-0007).
   */
  readonly producer: EvidenceProducer;
  readonly integrity: {
    readonly sha256: string;
    readonly byteSize: number;
  };
  readonly range?: {
    readonly sequenceFrom: number;
    readonly sequenceTo: number;
  };
  readonly redaction: {
    readonly profile: RedactionProfile;
    readonly removedFields: readonly string[];
  };
  readonly retention: {
    readonly createdAt: string;
    readonly expiresAt: string;
  };
}

export type ScenarioResult = 'PASSED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT' | 'DIRTY';
export type CleanupResult = 'PASSED' | 'FAILED' | 'SKIPPED';

/**
 * KPI-12: `result` ve `cleanup` AYRI alanlardır.
 *
 * Cleanup failure ana test sonucunu gizlemez ve ana test başarısı cleanup
 * failure'ı gizlemez. Bu ayrım tip düzeyinde zorunludur; birleşik tek bir
 * "status" alanı bilinçli olarak yoktur.
 */
export interface ReportManifest extends ProvenanceChain {
  readonly reportId: string;
  readonly runId: string;
  readonly compatibilityProfile: string;
  readonly fixtureId: string | null;
  readonly result: ScenarioResult;
  readonly cleanup: CleanupResult;
  /**
   * Kullanıcıya dönük limitation özeti. Saldırgan plugin varsayımı altında
   * kanıt bütünlüğü garanti edilmez (ADR-0007) — bu caveat raporda taşınır.
   */
  readonly knownLimitations: readonly string[];
}

/** Provenance zincirinin eksiksizliğini çalışma zamanında da doğrular. */
export function assertProvenanceComplete(chain: Partial<ProvenanceChain>): asserts chain is ProvenanceChain {
  const required: Array<keyof ProvenanceChain> = [
    'source_snapshot_id',
    'execution_environment_id',
    'build_artifact_id',
    'runtime_image_id',
    'server_instance_id',
    'scenario_run_id',
    'evidence_ids',
    'report_id',
  ];

  const missing = required.filter((k) => {
    const v = chain[k];
    return v === undefined || v === null || (Array.isArray(v) && v.length === 0) || v === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `EVIDENCE_INTEGRITY_MISMATCH: provenance zinciri eksik — ${missing.join(', ')}. ` +
        'Zinciri tamamlanmamış bir rapor kanıt değildir (KPI-09).',
    );
  }
}
