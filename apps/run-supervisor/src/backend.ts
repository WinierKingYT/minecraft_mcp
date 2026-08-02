/**
 * ExecutionBackend arayüzü — ADR-0004.
 *
 * `launchPaper` ve `launchActor` bilinçli olarak bu arayüzdedir: Paper'ı
 * backend dışında başlatan bir kısayol, güven sınıfı eşleşme kuralını sessizce
 * kırar.
 */

import { BACKEND_SECURITY_LEVEL, type ExecutionBackendKind } from '@mcpdev/contracts';

export interface SourceSnapshot {
  readonly sourceSnapshotId: string;
  readonly projectId: string;
  readonly inputManifestSha256: string;
}

export interface BuildPlan {
  readonly mode: 'build' | 'unit_test' | 'integration_test' | 'clean_build';
  readonly snapshot: SourceSnapshot;
  readonly network: 'offline' | 'repository-allowlist';
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface ResourceLimits {
  readonly cpu: number;
  readonly memoryMb: number;
  readonly pids: number;
  readonly diskMb: number;
}

export interface ExecutionEnvironment {
  readonly executionEnvironmentId: string;
  readonly backend: ExecutionBackendKind;
  readonly backendVersion: string;
  readonly sourceSnapshotId: string;
  readonly networkProfile: 'offline' | 'repository-allowlist';
  readonly resourceLimits: ResourceLimits;
}

export interface ProcessHandle {
  readonly pid: number;
  readonly executablePath: string;
  readonly startedAtMs: number;
}

export interface ExecutionBackend {
  readonly kind: ExecutionBackendKind;

  prepareSource(snapshot: SourceSnapshot): Promise<ExecutionEnvironment>;
  prepareDependencyCache(profileId: string): Promise<void>;
  runBuild(plan: BuildPlan): Promise<{ exitCode: number; artifactPath: string | null }>;
  launchPaper(runtimeImageId: string): Promise<ProcessHandle>;
  launchActor(actorPlanId: string): Promise<ProcessHandle>;
  collectArtifact(buildArtifactId: string): Promise<{ sha256: string; byteSize: number }>;
  terminate(handle: ProcessHandle): Promise<void>;
  destroyEnvironment(environmentHandle: ExecutionEnvironment): Promise<void>;
}

/**
 * ADR-0004 — runtime_backend.security_level >= build_backend.security_level.
 *
 * Container'da build edilme kararı, kaynağın güvenilmez sayıldığı anlamına
 * gelir. Aynı kaynaktan üretilen artifact'i DAHA ZAYIF bir sınırda çalıştırmak
 * izolasyon kararını anlamsız kılar. Tersi serbesttir: güvenilir bir kaynağı
 * daha güçlü bir sınırda çalıştırmak zararsızdır.
 *
 * NOT: V3 sözleşme belgesi bu kuralı `build >= runtime` biçiminde yazıyordu;
 * bu, kendi düzyazı açıklamasının tersidir (container build + local runtime'ı
 * SERBEST bırakırdı). Düzeltme ADR-0004 içinde kayıtlıdır.
 */
export function assertBackendPairing(
  buildBackend: ExecutionBackendKind,
  runtimeBackend: ExecutionBackendKind,
): void {
  if (BACKEND_SECURITY_LEVEL[runtimeBackend] < BACKEND_SECURITY_LEVEL[buildBackend]) {
    throw new BackendSecurityDowngradeError(buildBackend, runtimeBackend);
  }
}

export class BackendSecurityDowngradeError extends Error {
  readonly code = 'BACKEND_SECURITY_DOWNGRADE' as const;

  constructor(
    readonly buildBackend: ExecutionBackendKind,
    readonly runtimeBackend: ExecutionBackendKind,
  ) {
    super(
      `Runtime backend "${runtimeBackend}" build backend "${buildBackend}" değerinden daha zayıf bir izolasyon sınıfında.`,
    );
    this.name = 'BackendSecurityDowngradeError';
  }
}
