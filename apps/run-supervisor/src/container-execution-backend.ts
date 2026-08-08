/**
 * Container execution backend — ADR-0004 `ExecutionBackend` implementasyonu.
 *
 * Trusted Local'dan farkı (bkz. trusted-local-backend.ts): build ve runtime
 * aynı container izolasyon sınırında çalışır. Güven sınıfı eşleşme kuralı
 * (`assertBackendPairing`) sayesinde container'da build edilen bir artifact
 * Trusted Local runtime'a DÜŞÜRÜLEMEZ (BACKEND_SECURITY_DOWNGRADE).
 *
 * SPIKE-EXECUTION-CONTAINER-001 çıktısına göre:
 * - `runBuild`   → `ContainerBuildEnvironment` (ro source + /output redirect)
 * - `launchPaper`→ `mcpdev-runtime-*` container (Q2: supervisor erişim katmanı
 *   canlı deneyle netleşecek; şimdilik skeleton + loopback bulgusu)
 * - `collectArtifact` → `assertInsideDir` ile path containment
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { BuildPlan } from './build-plan.js';
import { ContainerBackend, ContainerBuildEnvironment } from './container-backend.js';
import { selectArtifact, type SelectedArtifact } from './artifact-selection.js';

export interface ContainerExecutionOptions {
  /** Docker image (JDK 25 içermelidir — Paper 26.2 toolchain). */
  readonly image?: string;
  /** ContainerBackend; verilmezse varsayılan oluşturulur. */
  readonly backend?: ContainerBackend;
  /** Build'ler arasında paylaşılan ro dependency cache (host dizini). */
  readonly dependencyCacheDir?: string;
  readonly log?: (level: string, event: string, fields: Record<string, unknown>) => void;
}

export interface ContainerBuildContext {
  readonly projectId: string;
  /** Container'a mount edilecek kaynak kökü (host yolu). */
  readonly projectRoot: string;
  /** Build sonrası artifact'in aranacağı host dizini. */
  readonly outputDir: string;
  readonly timeoutMs?: number;
  readonly expectedArtifactFileName?: string | undefined;
}

export interface ContainerExecutionEnvironmentInfo {
  readonly executionEnvironmentId: string;
  readonly containerNamePrefix: string;
}

/**
 * Container backend — ExecutionBackend yüzeyinin bir alt kümesini uygular
 * (M1 kapsamı: build + artifact collect). `launchPaper`/`launchActor` canlı
 * deney sonrası netleşecek erişim katmanına bağlıdır.
 */
export class ContainerExecutionBackend {
  readonly #options: ContainerExecutionOptions;
  readonly #backend: ContainerBackend;
  #environments = new Set<string>();

  constructor(options: ContainerExecutionOptions = {}) {
    this.#options = options;
    this.#backend = options.backend ?? new ContainerBackend({ ...(options.image ? { image: options.image } : {}) });
  }

  get kind(): 'container' {
    return 'container';
  }

  #log(level: string, event: string, fields: Record<string, unknown> = {}): void {
    this.#options.log?.(level, event, fields);
  }

  async isAvailable(): Promise<boolean> {
    return this.#backend.isAvailable();
  }

  async getAvailability() {
    return this.#backend.getAvailability();
  }

  /**
   * ADR-0004 — her yürütme bir `execution_environment_id` taşır (provenance
   * zincirinin ikinci halkası). Container kimliği: prefix + benzersiz sonek.
   */
  prepareSource(): ContainerExecutionEnvironmentInfo {
    const executionEnvironmentId = `exe_${randomBytes(12).toString('hex')}`;
    this.#environments.add(executionEnvironmentId);
    return { executionEnvironmentId, containerNamePrefix: 'mcpdev-build' };
  }

  /**
   * Dependency cache'i hazırlar — container'a RO mount edilecek host dizini.
   * Profil bazlı verilirse dizin boşsa offline mod bağımlılık çözemez;
   * provisioning modu öncesi host'ta doldurulması beklenir.
   */
  async prepareDependencyCache(profileId: string): Promise<string> {
    const dir = join(await mkdtemp(join(tmpdir(), 'mcpdev-cache-')), profileId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Container içinde Gradle build + artifact collect.
   *
   * Build "copy-in" modeliyle çalışır (SPIKE-EXECUTION-CONTAINER-001): kaynak
   * `/output/src` kopyasına, build çıktısı da oradaki `build/libs` altına
   * yazılır; host mount köküne göre seçim `src/build/libs` içinden yapılır.
   */
  async runBuild(
    plan: BuildPlan,
    context: ContainerBuildContext,
  ): Promise<{ exitCode: number; artifact: SelectedArtifact | null; output: string; timedOut: boolean }> {
    const info = this.prepareSource();
    this.#log('INFO', 'container.build_started', {
      execution_environment_id: info.executionEnvironmentId,
      plan_mode: plan.mode,
      network: plan.network,
    });

    const env = new ContainerBuildEnvironment(this.#backend, context.projectRoot, context.outputDir);
    const result = await env.build(context.projectId, ['./gradlew', ...plan.args], {
      network: plan.network,
      ...(this.#options.dependencyCacheDir ? { dependencyCacheDir: this.#options.dependencyCacheDir } : {}),
      timeoutMs: context.timeoutMs ?? plan.timeoutMs,
    });

    if (result.exitCode !== 0) {
      return { exitCode: result.exitCode, artifact: null, output: result.stdout + result.stderr, timedOut: result.timedOut };
    }

    // Artifact: /output/src/build/libs altında; host mount köküne göre 'src/build/libs'.
    const artifact = await selectArtifact(context.outputDir, {
      dirs: ['src/build/libs'],
      expectedFileName: context.expectedArtifactFileName,
    });

    this.#log('INFO', 'container.build_completed', {
      execution_environment_id: info.executionEnvironmentId,
      exit_code: result.exitCode,
      duration_ms: result.durationMs,
      artifact_sha256: artifact.sha256,
    });

    return { exitCode: result.exitCode, artifact, output: result.stdout + result.stderr, timedOut: result.timedOut };
  }

  /**
   * Artifact'ın host tarafındaki koleksiyonu — path containment `assertInsideDir`
   * ile garanti edilir (ST-CONTAINER-EXPORT-001).
   */
  async collectArtifact(artifactPath: string, outputDir: string): Promise<{ sha256: string; byteSize: number }> {
    const artifact = await selectArtifact(outputDir, {
      dirs: ['libs'],
      expectedFileName: artifactPath.split(/[\\/]/).pop(),
    });
    return { sha256: artifact.sha256, byteSize: artifact.byteSize };
  }

  /** Yürütme ortamı kaydını temizler (kayıt tutma katmanı için). */
  async destroyEnvironment(executionEnvironmentId: string): Promise<void> {
    this.#environments.delete(executionEnvironmentId);
  }
}
