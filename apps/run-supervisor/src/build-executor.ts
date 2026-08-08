/**
 * Build Executor — snapshot'tan artifact'e provenance zinciri.
 *
 * Sıra bilinçlidir ve kısayol kabul etmez:
 *
 *   1. Trust doğrulaması        (untrusted/revoked build çalıştıramaz)
 *   2. Backend izni
 *   3. Source snapshot           (değişmez kaynak durumu)
 *   4. Supply-chain doğrulaması  (wrapper, checksum, lock, verification)
 *   5. Build yürütme             (shell yok, env allowlist, timeout, limit)
 *   6. Snapshot YENİDEN doğrulaması (SOURCE_CHANGED_DURING_BUILD)
 *   7. Artifact seçimi           (belirsizlik sessizce çözülmez)
 *   8. Provenance manifest
 *
 * 6. adım kritiktir: build sırasında kaynak değiştiyse artifact atılır, çünkü
 * rapor aksi hâlde derlenmeyen bir kaynağa atıfta bulunurdu (KPI-09).
 */

import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { ExecutionBackendKind } from '@mcpdev/contracts';
import type { ProjectRegistry, RegisteredProject } from './project-registry.js';
import { createSourceSnapshot, assertSnapshotUnchanged, type SourceSnapshot } from './source-snapshot.js';
import { validateGradleProject, type GradleValidationOptions, type ValidationFinding } from './gradle-validation.js';
import { createBuildPlan, type BuildMode, type BuildPlan, type NetworkPolicy } from './build-plan.js';
import { runBuild, BuildExecutionError, type BuildRunResult } from './trusted-local-backend.js';
import { selectArtifact, type SelectedArtifact } from './artifact-selection.js';
import { parseDiagnostics, suggestAction, type DiagnosticsSummary } from './diagnostics.js';
import { resolveJavaForProfile } from './java-toolchain.js';
import { EvidenceStore, type EvidenceProducer } from '@mcpdev/evidence-model';
import type { ContainerExecutionBackend } from './container-execution-backend.js';

export interface BuildRequest {
  readonly projectId: string;
  readonly mode: BuildMode;
  readonly backend: ExecutionBackendKind;
  readonly network?: NetworkPolicy;
  readonly provisioningApproved?: boolean;
  readonly expectedArtifactFileName?: string | undefined;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly rejectDirty?: boolean;
}

export interface BuildProvenance {
  readonly sourceSnapshotId: string;
  readonly inputManifestSha256: string;
  readonly executionEnvironmentId: string;
  readonly backend: ExecutionBackendKind;
  readonly buildArtifactId: string;
  readonly artifactSha256: string;
  readonly gradleVersion: string | null;
  readonly gradleDistributionSha256: string | null;
  /** Bu build'in ürettiği kanıtlar. Boş olması gizlenmez. */
  readonly evidenceIds: readonly string[];
}

export interface BuildFailure {
  readonly code: string;
  readonly message: string;
  /** KPI-08: her hata önerilen aksiyon taşır. */
  readonly suggestedAction: string;
}

/**
 * Build sonucu.
 *
 * Alanlar bilinçli olarak nullable'dır: build trust doğrulamasında düşerse
 * snapshot hiç alınmamıştır, supply-chain doğrulamasında düşerse plan hiç
 * oluşturulmamıştır. Bunları non-null göstermek, olmayan bir kanıtı var gibi
 * sunmak olurdu.
 */
export interface BuildOutcome {
  readonly ok: boolean;
  readonly runId: string;
  readonly snapshot: SourceSnapshot | null;
  readonly plan: BuildPlan | null;
  readonly validation: readonly ValidationFinding[];
  readonly run: BuildRunResult | null;
  readonly diagnostics: DiagnosticsSummary | null;
  readonly artifact: SelectedArtifact | null;
  readonly provenance: BuildProvenance | null;
  readonly failure: BuildFailure | null;
}

export interface BuildExecutorOptions {
  readonly registry: ProjectRegistry;
  readonly gradleValidation: GradleValidationOptions;
  /** Uyumluluk profilindeki Java major sürümü. */
  readonly javaMajor: number;
  /**
   * Build kanıtlarının yazılacağı depo.
   *
   * Verilmezse build yine çalışır fakat kanıt üretilmez; bu durum sonuçta
   * `evidenceIds: []` olarak GÖRÜNÜR, sessizce gizlenmez.
   */
  readonly evidence?: EvidenceStore;
  /**
   * Build'ler arasında paylaşılan doğrulanmış dependency cache.
   *
   * Reproducible (offline) modun ön koşuludur. Provisioning modu bu dizini
   * doldurur; offline mod yalnızca okur.
   */
  readonly dependencyCacheDir?: string;
  /**
   * Container backend — `request.backend === 'container'` build'leri bu
   * implementasyonla koşar. Verilmezse container istekleri BACKEND_UNAVAILABLE
   * üretir (M1 öncesi davranış korunur).
   */
  readonly container?: ContainerExecutionBackend;
  /**
   * Artifact'ların kopyalandığı kalıcı depo kökü (M1).
   *
   * Container build'leri geçici çalışma dizininde üretilir ve executor
   * temizliği o dizini siler; build kaydı silinen bir yolu gösteremez.
   * Trusted Local artifact'leri de aynı depoya kopyalanır: proje `build/libs`
   * çıktısı sonraki build'ler tarafından üzerine yazılabilir, build kaydının
   * doğruladığı sha256 değeri kalıcı bir dosyaya bağlanmalıdır.
   */
  readonly artifactStoreDir: string;
  readonly log?: (level: string, event: string, fields: Record<string, unknown>) => void;
}

export class BuildExecutor {
  readonly #options: BuildExecutorOptions;

  constructor(options: BuildExecutorOptions) {
    this.#options = options;
  }

  #log(level: string, event: string, fields: Record<string, unknown> = {}): void {
    this.#options.log?.(level, event, fields);
  }

  /**
   * Seçilen artifact'ı kalıcı depoya kopyalar ve sha256'yı kopya üzerinde
   * yeniden hesaplar. Dönen artifact, build kaydının ve runtime launch'ın
   * (build_id → plugin_launch) referans aldığı dosyayı taşır.
   */
  async #persistArtifact(artifact: SelectedArtifact, runId: string): Promise<SelectedArtifact> {
    const target = join(this.#options.artifactStoreDir, runId, basename(artifact.absolutePath));
    await mkdir(dirname(target), { recursive: true });
    await cp(artifact.absolutePath, target);
    const sha256 = createHash('sha256').update(await readFile(target)).digest('hex');
    const byteSize = (await stat(target)).size;
    return { ...artifact, absolutePath: target, sha256, byteSize };
  }

  /**
   * Build kanıtlarını depoya yazar.
   *
   * Üç ayrı kanıt üretilir çünkü üç ayrı soruya cevap verirler: "ne oldu"
   * (build log), "neyi düzeltmeliyim" (diagnostics), "ne üretildi" (artifact
   * manifest). Tek bir birleşik kanıt, byte limiti nedeniyle kesildiğinde
   * üçünü birden kaybettirirdi.
   *
   * Kanıt yazımı build'i BAŞARISIZ SAYMAZ: derleme başarılıysa kanıt yazma
   * hatası ana sonucu gizlememelidir (KPI-12 ile aynı ilke).
   */
  async #writeEvidence(
    runId: string,
    sourceSnapshotId: string,
    run: BuildRunResult,
    diagnostics: DiagnosticsSummary,
    artifact: SelectedArtifact,
  ): Promise<string[]> {
    const store = this.#options.evidence;
    if (!store) return [];

    const producer: EvidenceProducer = { component: 'run-supervisor', version: '0.1.0-prototype.0' };
    const ids: string[] = [];

    const write = async (kind: 'build-log' | 'compiler-diagnostics' | 'artifact-manifest', content: string) => {
      try {
        const manifest = await store.put({ runId, scenarioRunId: null, kind, producer, content });
        ids.push(manifest.evidenceId);
      } catch (err) {
        this.#log('WARN', 'build.evidence_write_failed', {
          run_id: runId,
          kind,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    await write('build-log', run.output);
    await write(
      'compiler-diagnostics',
      JSON.stringify(
        {
          errors: diagnostics.errors,
          warnings: diagnostics.warnings,
          failed_tasks: diagnostics.failedTasks,
          diagnostics: diagnostics.diagnostics.map((d) => ({ ...d, suggested_action: suggestAction(d) })),
        },
        null,
        2,
      ),
    );
    await write(
      'artifact-manifest',
      JSON.stringify(
        {
          build_artifact_id: artifact.buildArtifactId,
          // Proje köküne göre yol; mutlak host yolu kanıta girmez.
          path: artifact.path,
          sha256: artifact.sha256,
          byte_size: artifact.byteSize,
          source_snapshot_id: sourceSnapshotId,
          build_duration_ms: run.durationMs,
        },
        null,
        2,
      ),
    );

    return ids;
  }

  async execute(request: BuildRequest): Promise<BuildOutcome> {
    const runId = `run_${randomBytes(12).toString('hex')}`;
    const registry = this.#options.registry;

    // 1-2. Trust ve backend izni
    const project: RegisteredProject = registry.assertBuildAllowed(request.projectId);
    registry.assertBackendAllowed(request.projectId, request.backend);

    const container = this.#options.container;
    if (request.backend === 'container' && !container) {
      return failure(runId, null, null, [], {
        code: 'BACKEND_UNAVAILABLE',
        message: `"container" backend'i bu sürümde yapılandırılmadı.`,
        suggestedAction: 'Supervisor ayarlarında ContainerExecutionBackend bağlayın veya Trusted Local backend kullanın.',
      });
    }

    // 3. Source snapshot
    const snapshot = await createSourceSnapshot(project, {
      ...(request.rejectDirty === undefined ? {} : { rejectDirty: request.rejectDirty }),
    });
    this.#log('INFO', 'build.snapshot', {
      run_id: runId,
      source_snapshot_id: snapshot.sourceSnapshotId,
      files: snapshot.entries.length,
      dirty: snapshot.git.dirty,
    });

    // 4. Supply-chain doğrulaması
    const validation = await validateGradleProject(project.canonicalRoot, this.#options.gradleValidation);
    if (!validation.ok) {
      const first = validation.findings.find((f) => f.severity === 'error')!;
      this.#log('WARN', 'build.validation_failed', { run_id: runId, findings: validation.findings.length });
      return failure(runId, snapshot, null, validation.findings, {
        code: first.code,
        message: first.message,
        suggestedAction: first.suggestedAction,
      });
    }

    // 5. Build
    const plan = createBuildPlan({
      mode: request.mode,
      ...(request.network ? { network: request.network } : {}),
      ...(request.provisioningApproved === undefined ? {} : { provisioningApproved: request.provisioningApproved }),
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      ...(request.maxOutputBytes === undefined ? {} : { maxOutputBytes: request.maxOutputBytes }),
    });

    const workDir = await mkdtemp(join(tmpdir(), 'mcpdev-build-'));
    let run: BuildRunResult;
    let containerArtifact: SelectedArtifact | null = null;
    let artifactPersisted = false;
    try {
      if (request.backend === 'container') {
        // Container build: kaynak ro mount + /output redirect (init script);
        // çıktı host'taki mount köküne yazılır, artifact oradan seçilir.
        const outputDir = join(workDir, 'output');
        const result = await container!.runBuild(plan, {
          projectId: request.projectId,
          projectRoot: project.canonicalRoot,
          outputDir,
          ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
          ...(request.expectedArtifactFileName !== undefined
            ? { expectedArtifactFileName: request.expectedArtifactFileName }
            : {}),
        });
        run = {
          exitCode: result.exitCode,
          output: result.output,
          truncated: result.output.length > plan.maxOutputBytes,
          durationMs: 0,
          timedOut: result.timedOut,
          command: 'docker',
          args: [],
        };
        containerArtifact = result.artifact;
        // Artifact geçici workDir'de; persist edilmeden temizlenemez.
        if (containerArtifact) {
          try {
            containerArtifact = await this.#persistArtifact(containerArtifact, runId);
            artifactPersisted = true;
          } catch (err) {
            return failure(runId, snapshot, run, validation.findings, {
              code: 'ARTIFACT_PERSIST_FAILED',
              message: err instanceof Error ? err.message : String(err),
              suggestedAction: 'Artifact deposunun yazılabilir olduğunu doğrulayın ve build\'i tekrarlayın.',
            }, null, plan);
          }
        }
      } else {
        // Java, uyumluluk profilindeki major sürüme sabitlenir; wrapper script'in
        // PATH'ten bulacağı Java sürprizi ortadan kalkar. (Container backend'de
        // Java sürümünü image sabitler, burada çözüm gerekmez.)
        const java = await resolveJavaForProfile(this.#options.javaMajor);
        run = await runBuild({
          projectRoot: project.canonicalRoot,
          workDir,
          plan,
          javaExecutable: java.executable,
          ...(this.#options.dependencyCacheDir ? { dependencyCacheDir: this.#options.dependencyCacheDir } : {}),
        });
      }
    } finally {
      // Geçici Gradle home ve HOME arkada bırakılmaz.
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }

    const diagnostics = parseDiagnostics(run.output, project.canonicalRoot);

    this.#log(run.exitCode === 0 ? 'INFO' : 'WARN', 'build.completed', {
      run_id: runId,
      exit_code: run.exitCode,
      duration_ms: run.durationMs,
      errors: diagnostics.errors,
      warnings: diagnostics.warnings,
      truncated: run.truncated,
    });

    if (run.timedOut) {
      return failure(runId, snapshot, run, validation.findings, {
        code: 'BUILD_TIMEOUT',
        message: `Build ${plan.timeoutMs} ms süre limitini aştı.`,
        suggestedAction: 'Süre limitini artırın veya clean_build yerine artımlı build kullanın.',
      }, diagnostics, plan);
    }

    if (run.exitCode !== 0) {
      const firstError = diagnostics.diagnostics.find((d) => d.severity === 'error');
      return failure(runId, snapshot, run, validation.findings, {
        code: 'BUILD_FAILED',
        message: firstError
          ? `${firstError.path ?? '(bilinmeyen dosya)'}:${firstError.line ?? '?'} ${firstError.message}`
          : `Build başarısız (exit ${run.exitCode}).`,
        suggestedAction: firstError ? suggestAction(firstError) : 'Build loglarını inceleyin.',
      }, diagnostics, plan);
    }

    // 6. Snapshot YENİDEN doğrulaması
    try {
      await assertSnapshotUnchanged(project, snapshot);
    } catch (err) {
      // Artifact ATILIR: rapor derlenmeyen bir kaynağa atıfta bulunamaz.
      return failure(runId, snapshot, run, validation.findings, {
        code: 'SOURCE_CHANGED_DURING_BUILD',
        message: err instanceof Error ? err.message : String(err),
        suggestedAction: 'Dosya değişikliklerini durdurup build\'i yeni bir snapshot ile tekrarlayın.',
      }, diagnostics, plan);
    }

    // 7. Artifact seçimi
    let artifact: SelectedArtifact;
    try {
      if (containerArtifact) {
        // Container build: artifact container içinde zaten deterministik seçildi
        // (host mount üzerinden); yeniden seçim belirsizlik doğurabilirdi.
        artifact = containerArtifact;
      } else {
        artifact = await selectArtifact(project.canonicalRoot, {
          expectedFileName: request.expectedArtifactFileName,
        });
      }
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'ARTIFACT_NOT_FOUND';
      return failure(runId, snapshot, run, validation.findings, {
        code,
        message: err instanceof Error ? err.message : String(err),
        suggestedAction: 'Build çıktısını ve beklenen artifact adını kontrol edin.',
      }, diagnostics, plan);
    }

    // 7b. Kalıcı depo kopyası: proje build/libs çıktısı sonraki build'lerce
    // üzerine yazılabilir; build kaydı depodaki kopyaya bağlanır. Container
    // artifact'leri zaten depoda olduğundan tekrar kopyalanmaz.
    if (!artifactPersisted) {
      try {
        artifact = await this.#persistArtifact(artifact, runId);
      } catch (err) {
        return failure(runId, snapshot, run, validation.findings, {
          code: 'ARTIFACT_PERSIST_FAILED',
          message: err instanceof Error ? err.message : String(err),
          suggestedAction: 'Artifact deposunun yazılabilir olduğunu doğrulayın ve build\'i tekrarlayın.',
        }, diagnostics, plan);
      }
    }

    // 8. Kanıt yazımı ve provenance
    const evidenceIds = await this.#writeEvidence(runId, snapshot.sourceSnapshotId, run, diagnostics, artifact);

    const provenance: BuildProvenance = {
      sourceSnapshotId: snapshot.sourceSnapshotId,
      inputManifestSha256: snapshot.inputManifestSha256,
      executionEnvironmentId: `exe_${randomBytes(12).toString('hex')}`,
      backend: request.backend,
      buildArtifactId: artifact.buildArtifactId,
      artifactSha256: artifact.sha256,
      gradleVersion: validation.wrapper.version,
      gradleDistributionSha256: validation.wrapper.distributionSha256,
      evidenceIds,
    };

    this.#log('INFO', 'build.artifact', {
      run_id: runId,
      build_artifact_id: artifact.buildArtifactId,
      artifact_sha256: artifact.sha256,
      source_snapshot_id: snapshot.sourceSnapshotId,
    });

    return {
      ok: true,
      runId,
      snapshot,
      plan,
      validation: validation.findings,
      run,
      diagnostics,
      artifact,
      provenance,
      failure: null,
    };
  }
}

function failure(
  runId: string,
  snapshot: SourceSnapshot | null,
  run: BuildRunResult | null,
  validation: readonly ValidationFinding[],
  failureInfo: BuildFailure,
  diagnostics: DiagnosticsSummary | null = null,
  plan: BuildPlan | null = null,
): BuildOutcome {
  return {
    ok: false,
    runId,
    snapshot,
    plan,
    validation,
    run,
    diagnostics,
    artifact: null,
    provenance: null,
    failure: failureInfo,
  };
}

export { BuildExecutionError };
