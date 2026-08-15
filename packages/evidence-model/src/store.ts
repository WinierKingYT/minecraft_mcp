/**
 * Content-addressed evidence store.
 *
 * docs/contracts/evidence.md:
 *   - SHA-256 içerik adresleme
 *   - Atomic temp-write + rename
 *   - Checksums
 *   - No raw secret
 *   - No absolute host path in public report
 *
 * İçerik adresleme yalnızca tekilleştirme için değildir: aynı içerik her zaman
 * aynı kimliğe düşer, bu yüzden bir kanıtın "değiştirilip aynı kimlikle geri
 * konması" imkânsızdır. Değiştirme tespit edilir (ADR-0007: TESPİT, önleme değil).
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidenceKind, EvidenceManifest, EvidenceProducer, RedactionProfile } from './index.js';

export class EvidenceStoreError extends Error {
  constructor(
    readonly code: 'EVIDENCE_WRITE_FAILED' | 'EVIDENCE_NOT_FOUND' | 'EVIDENCE_INTEGRITY_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'EvidenceStoreError';
  }
}

export interface PutEvidenceRequest {
  readonly runId: string;
  readonly scenarioRunId: string | null;
  readonly kind: EvidenceKind;
  readonly producer: EvidenceProducer;
  readonly content: string | Uint8Array;
  readonly redactionProfile?: RedactionProfile;
  readonly retentionHours?: number;
  readonly range?: { readonly sequenceFrom: number; readonly sequenceTo: number };
}

/**
 * Varsayılan redaction desenleri.
 *
 * Güvensiz varsayılan bulunmaz (CF-06): profil belirtilmezse `default-v1`
 * uygulanır, `none` açıkça istenmelidir.
 */
const REDACTION_PATTERNS: ReadonlyArray<{ readonly field: string; readonly pattern: RegExp }> = [
  { field: 'authorization', pattern: /(authorization"?\s*[:=]\s*"?)(bearer\s+)?[A-Za-z0-9._~+/-]{8,}/gi },
  { field: 'token', pattern: /((?:bridge[_-]?)?token"?\s*[:=]\s*"?)[A-Za-z0-9._~+/-]{8,}/gi },
  { field: 'secret', pattern: /(secret"?\s*[:=]\s*"?)[^\s",}]{4,}/gi },
  { field: 'password', pattern: /(password"?\s*[:=]\s*"?)[^\s",}]{1,}/gi },
  { field: 'player.ip', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
];

export interface RedactionOutcome {
  readonly text: string;
  readonly removedFields: readonly string[];
}

export function applyRedaction(text: string, profile: RedactionProfile): RedactionOutcome {
  if (profile === 'none') {
    return { text, removedFields: [] };
  }

  const removed: string[] = [];
  let out = text;

  for (const { field, pattern } of REDACTION_PATTERNS) {
    // `strict-v1` IP dahil her şeyi maskeler; `default-v1` de öyle davranır.
    // Fark, ileride eklenecek alanların kapsamındadır.
    const next = out.replace(pattern, (_match, prefix: string | undefined) => `${prefix ?? ''}[REDACTED]`);
    if (next !== out) {
      removed.push(field);
      out = next;
    }
  }

  return { text: out, removedFields: removed };
}

export class EvidenceStore {
  readonly #root: string;
  readonly #defaultRetentionHours: number;

  constructor(root: string, defaultRetentionHours = 24) {
    this.#root = root;
    this.#defaultRetentionHours = defaultRetentionHours;
  }

  /** sha256 -> ab/cd/abcdef... (dizin başına dosya sayısını sınırlar) */
  #objectPath(sha256: string): string {
    return join(this.#root, 'objects', sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  }

  #manifestPath(evidenceId: string): string {
    return join(this.#root, 'manifests', `${evidenceId}.json`);
  }

  async put(request: PutEvidenceRequest): Promise<EvidenceManifest> {
    const profile: RedactionProfile = request.redactionProfile ?? 'default-v1';

    const raw =
      typeof request.content === 'string' ? request.content : new TextDecoder().decode(request.content);
    const { text, removedFields } = applyRedaction(raw, profile);
    const bytes = new TextEncoder().encode(text);

    // Checksum REDACTION SONRASI içerik üzerinden hesaplanır: depoda duran ve
    // okunacak olan içerik budur. Ham içeriğin hash'ini saklamak, doğrulaması
    // imkânsız bir değer kaydetmek olurdu.
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    const objectPath = this.#objectPath(sha256);
    try {
      await mkdir(join(objectPath, '..'), { recursive: true });
      if (!existsSync(objectPath)) {
        // Atomic: temp + rename. Yarım yazılmış nesne asla görünmez.
        const temp = `${objectPath}.${process.pid}.${randomBytes(4).toString('hex')}.part`;
        await writeFile(temp, bytes, { mode: 0o600 });
        await rename(temp, objectPath);
      }
    } catch (err) {
      throw new EvidenceStoreError(
        'EVIDENCE_WRITE_FAILED',
        `Evidence yazılamadı: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + (request.retentionHours ?? this.#defaultRetentionHours) * 3_600_000,
    );

    const manifest: EvidenceManifest = {
      evidenceId: `ev_${randomBytes(12).toString('hex')}`,
      runId: request.runId,
      scenarioRunId: request.scenarioRunId,
      kind: request.kind,
      producer: request.producer,
      integrity: { sha256, byteSize: bytes.byteLength },
      ...(request.range ? { range: request.range } : {}),
      redaction: { profile, removedFields },
      retention: { createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() },
    };

    try {
      await mkdir(join(this.#root, 'manifests'), { recursive: true });
      const manifestPath = this.#manifestPath(manifest.evidenceId);
      const temp = `${manifestPath}.part`;
      await writeFile(temp, JSON.stringify(manifest, null, 2), { mode: 0o600 });
      await rename(temp, manifestPath);
    } catch (err) {
      throw new EvidenceStoreError(
        'EVIDENCE_WRITE_FAILED',
        `Evidence manifest yazılamadı: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return manifest;
  }

  async getManifest(evidenceId: string): Promise<EvidenceManifest> {
    const path = this.#manifestPath(evidenceId);
    if (!existsSync(path)) {
      throw new EvidenceStoreError('EVIDENCE_NOT_FOUND', `Evidence bulunamadı: ${evidenceId}`);
    }
    return JSON.parse(await readFile(path, 'utf8')) as EvidenceManifest;
  }

  /**
   * İçeriği okur ve checksum'ı YENİDEN doğrular.
   *
   * Doğrulama her okumada yapılır: aynı JVM'deki kötü niyetli bir plugin veya
   * host üzerindeki başka bir process nesneyi değiştirmiş olabilir. Bu bir
   * TESPİT mekanizmasıdır, önleme değil (ADR-0007).
   */
  async get(evidenceId: string, maxBytes = 1_048_576): Promise<{ manifest: EvidenceManifest; text: string }> {
    const manifest = await this.getManifest(evidenceId);
    const objectPath = this.#objectPath(manifest.integrity.sha256);

    if (!existsSync(objectPath)) {
      throw new EvidenceStoreError(
        'EVIDENCE_NOT_FOUND',
        `Evidence nesnesi bulunamadı: ${manifest.integrity.sha256}`,
      );
    }

    const bytes = await readFile(objectPath);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== manifest.integrity.sha256) {
      throw new EvidenceStoreError(
        'EVIDENCE_INTEGRITY_MISMATCH',
        `Evidence checksum'ı manifest ile eşleşmiyor.\n  beklenen: ${manifest.integrity.sha256}\n  gerçek  : ${actual}`,
      );
    }
    if (bytes.byteLength !== manifest.integrity.byteSize) {
      throw new EvidenceStoreError('EVIDENCE_INTEGRITY_MISMATCH', 'Evidence boyutu manifest ile eşleşmiyor.');
    }

    const text = new TextDecoder().decode(bytes.subarray(0, maxBytes));
    return { manifest, text };
  }

  /**
   * Manifest dizinini okur. Bozuk/yarım manifest yok sayılır; aksi hâlde tek
   * bir bozuk dosya tüm listeleme yüzeyini (run kayıtları dahil) düşürürdü.
   */
  async listManifests(): Promise<EvidenceManifest[]> {
    const dir = join(this.#root, 'manifests');
    if (!existsSync(dir)) {
      return [];
    }
    const names = await readdir(dir);
    const manifests: EvidenceManifest[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        manifests.push(JSON.parse(await readFile(join(dir, name), 'utf8')) as EvidenceManifest);
      } catch {
        // Bozuk manifest okuma listesini düşürmez.
      }
    }
    return manifests;
  }

  /**
   * Bir run'a ait tüm kanıt manifestlerini döndürür. `runId` = scenario run
   * kimliğidir (scenario-evidence her kanıtı runId altında yazar). MCP Resources
   * run/{run_id} okumaları bu yüzey üzerinden çözülür.
   */
  async getManifestsByRunId(runId: string): Promise<EvidenceManifest[]> {
    const all = await this.listManifests();
    return all.filter((m) => m.runId === runId);
  }

  /** Depoda kayıtlı tüm run kimliklerini (deterministik sırayla) döndürür. */
  async listRunIds(): Promise<string[]> {
    const runIds = new Set<string>();
    for (const m of await this.listManifests()) {
      if (m.runId.length > 0) {
        runIds.add(m.runId);
      }
    }
    return [...runIds].sort();
  }

  /** Retention süresi geçmiş manifestleri siler; nesneler paylaşımlı olduğu için korunur. */
  async expire(evidenceIds: readonly string[], now = new Date()): Promise<string[]> {
    const expired: string[] = [];
    for (const id of evidenceIds) {
      const manifest = await this.getManifest(id).catch(() => null);
      if (!manifest) continue;
      if (new Date(manifest.retention.expiresAt).getTime() <= now.getTime()) {
        await rm(this.#manifestPath(id), { force: true });
        expired.push(id);
      }
    }
    return expired;
  }
}
