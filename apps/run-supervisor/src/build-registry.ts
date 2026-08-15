/**
 * Build Registry — başarılı build'lerin artifact provenance kaydı (bellek içi).
 *
 * Build sonucuyla plugin_launch arasındaki köprüdür: plugin_launch yalnızca
 * `build_id` alır; mutlak path KABUL ETMEZ (FS-03). Artifact, bu kayıttan
 * çözümlenir ve launch anında sha256 yeniden doğrulanır — araya giren her
 * değişiklik (tamper/bozulma) ARTIFACT_INTEGRITY_MISMATCH üretir, sessizce
 * geçilmez.
 *
 * Bellek içidir; build kayıtlarının kalıcılığı (disk üstü kayıt + retention)
 * M2B kapsamıdır.
 */

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export class BuildRegistryError extends Error {
  constructor(
    readonly code: 'BUILD_NOT_FOUND' | 'ARTIFACT_NOT_FOUND' | 'ARTIFACT_INTEGRITY_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'BuildRegistryError';
  }
}

export interface BuildRecord {
  readonly buildId: string;
  readonly projectId: string;
  readonly mode: string;
  readonly backend: 'trusted-local' | 'container';
  readonly status: 'completed' | 'failed';
  /** Mutlak host yolu; başarısız build'lerde null. */
  readonly artifactPath: string | null;
  readonly artifactSha256: string | null;
  /** Proje köküne göre yol (kanıt için). */
  readonly artifactRelativePath: string | null;
  readonly evidenceIds: readonly string[];
  readonly durationMs: number;
  readonly createdAt: string;
}

export interface ResolvedBuildArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly relativePath: string;
}

export class BuildRegistry {
  readonly #records = new Map<string, BuildRecord>();

  get size(): number {
    return this.#records.size;
  }

  /** Tüm build kayıtlarını oluşturma sırasıyla döndürür. */
  list(): BuildRecord[] {
    return [...this.#records.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt),
    );
  }

  record(record: BuildRecord): void {
    this.#records.set(record.buildId, record);
  }

  get(buildId: string): BuildRecord | null {
    return this.#records.get(buildId) ?? null;
  }

  /**
   * Build artifact'ini doğrulanmış biçimde çözer.
   *
   * Kapılar sırasıyla: build kaydı var → build başarılı → artifact yolu
   * kayıtlı → dosya yerinde → sha256 yeniden eşleşiyor. Her kapı ayrı bir
   * error kodu taşır (KPI-08).
   */
  async resolveArtifact(buildId: string): Promise<ResolvedBuildArtifact> {
    const record = this.#records.get(buildId);
    if (!record) {
      throw new BuildRegistryError(
        'BUILD_NOT_FOUND',
        `Build kaydı bulunamadı: ${buildId}. Bu oturumda üretilmemiş veya retention sonrası düşmüş olabilir.`,
      );
    }
    if (record.status !== 'completed' || !record.artifactPath || !record.artifactSha256) {
      throw new BuildRegistryError(
        'ARTIFACT_NOT_FOUND',
        `"${buildId}" build'i artifact üretmedi (status: ${record.status}).`,
      );
    }
    if (!existsSync(record.artifactPath)) {
      throw new BuildRegistryError(
        'ARTIFACT_NOT_FOUND',
        `Build artifact dosyası yerinde değil: ${record.artifactPath}.`,
      );
    }

    const actual = createHash('sha256').update(await readFile(record.artifactPath)).digest('hex');
    if (actual !== record.artifactSha256) {
      throw new BuildRegistryError(
        'ARTIFACT_INTEGRITY_MISMATCH',
        `Build artifact'ı kayıt anındaki sha256 ile eşleşmiyor.\n  beklenen: ${record.artifactSha256}\n  gerçek  : ${actual}`,
      );
    }

    return {
      path: record.artifactPath,
      sha256: actual,
      relativePath: record.artifactRelativePath ?? '',
    };
  }

  /**
   * Build metadata'sını mutlak host path İÇERMEDEN döndürür.
   *
   * MCP Resources artifact/{build_artifact_id} kaynağının arka verisidir
   * (docs/contracts/mcp.md: raw host path dışarı verilmez). Artifact varsa
   * `byteSize` dosyadan okunur; yoksa null kalır. Tam içerik doğrulaması
   * (sha256 re-read) bu yüzeyde yapılmaz — resources/read'a kadar ertelenir.
   */
  async describe(buildId: string): Promise<{
    readonly buildId: string;
    readonly projectId: string;
    readonly mode: string;
    readonly backend: BuildRecord['backend'];
    readonly status: BuildRecord['status'];
    readonly artifact:
      | {
          readonly id: string;
          readonly relativePath: string;
          readonly sha256: string;
          readonly byteSize: number;
        }
      | null;
    readonly createdAt: string;
    readonly durationMs: number;
  }> {
    const record = this.#records.get(buildId);
    if (!record) {
      throw new BuildRegistryError(
        'BUILD_NOT_FOUND',
        `Build kaydı bulunamadı: ${buildId}. Bu oturumda üretilmemiş veya retention sonrası düşmüş olabilir.`,
      );
    }

    let artifact: { id: string; relativePath: string; sha256: string; byteSize: number } | null = null;
    if (record.status === 'completed' && record.artifactPath && record.artifactSha256) {
      let byteSize = 0;
      try {
        byteSize = (await stat(record.artifactPath)).size;
      } catch {
        byteSize = 0;
      }
      artifact = {
        id: buildId,
        relativePath: record.artifactRelativePath ?? '',
        sha256: record.artifactSha256,
        byteSize,
      };
    }

    return {
      buildId: record.buildId,
      projectId: record.projectId,
      mode: record.mode,
      backend: record.backend,
      status: record.status,
      artifact,
      createdAt: record.createdAt,
      durationMs: record.durationMs,
    };
  }
}
