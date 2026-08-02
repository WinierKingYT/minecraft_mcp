/**
 * Paper JAR indirici — PaperMC Downloads Service v3.
 *
 * Kurallar (compatibility profile `rules` bölümü):
 *   - Download URL sabit metin olarak GÜVENİLMEZ; servis yanıtından çözülür.
 *   - Servis, yazılımı tanımlayan ve iletişim adresi içeren bir User-Agent
 *     zorunlu kılar; jenerik UA reddedilir.
 *   - İndirilen JAR'ın SHA-256'sı profildeki değerle eşleşmelidir.
 *   - Eşleşme her runtime oluşturmada yeniden doğrulanır (cache'ten okunsa bile).
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CompatibilityProfile } from './compatibility.js';

const SERVICE_BASE = 'https://fill.papermc.io/v3';

/**
 * Downloads Service jenerik User-Agent'ı (curl/wget/node-fetch) reddeder.
 * UA hem yazılımı tanımlamalı hem bir iletişim adresi içermelidir.
 */
export const USER_AGENT =
  'minecraft-plugin-dev-mcp/0.1.0-prototype.0 (https://github.com/mcpdev/minecraft-plugin-dev-mcp)';

export class PaperDownloadError extends Error {
  constructor(
    readonly code:
      | 'PAPER_VERSION_NOT_FOUND'
      | 'PAPER_BUILD_NOT_FOUND'
      | 'PAPER_CHANNEL_MISMATCH'
      | 'PAPER_JAR_CHECKSUM_INVALID'
      | 'PAPER_DOWNLOAD_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'PaperDownloadError';
  }
}

export interface ResolvedBuild {
  readonly minecraftVersion: string;
  readonly build: number;
  readonly channel: string;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly filename: string;
}

/** Test edilebilirlik için enjekte edilebilir fetch. */
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

interface BuildEntry {
  id?: number;
  channel?: string;
  downloads?: Record<string, { name?: string; url?: string; checksums?: { sha256?: string } }>;
}

/**
 * Profildeki build'i servis yanıtından çözer.
 *
 * Servis yanıtındaki checksum profildeki `jar_sha256` ile karşılaştırılır.
 * Uyuşmazlık, ya profilin bayatladığını ya da servis yanıtının değiştiğini
 * gösterir; ikisi de sessizce geçilemez.
 */
export async function resolveBuild(
  profile: CompatibilityProfile,
  fetchImpl: FetchLike,
): Promise<ResolvedBuild> {
  const version = profile.minecraft.version;
  const wantedBuild = profile.paper.build;

  const url = `${SERVICE_BASE}/projects/paper/versions/${encodeURIComponent(version)}/builds`;
  const response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });

  if (response.status === 404) {
    throw new PaperDownloadError(
      'PAPER_VERSION_NOT_FOUND',
      `Paper sürümü ${version} Downloads Service üzerinde bulunamadı.`,
    );
  }
  if (!response.ok) {
    throw new PaperDownloadError(
      'PAPER_DOWNLOAD_FAILED',
      `Build listesi alınamadı (HTTP ${response.status}).`,
    );
  }

  const builds = (await response.json()) as BuildEntry[];
  const entry = Array.isArray(builds) ? builds.find((b) => b.id === wantedBuild) : undefined;

  if (!entry) {
    throw new PaperDownloadError(
      'PAPER_BUILD_NOT_FOUND',
      `Paper ${version} için build ${wantedBuild} bulunamadı.`,
    );
  }

  if (entry.channel !== undefined && entry.channel.toUpperCase() !== profile.paper.channel.toUpperCase()) {
    throw new PaperDownloadError(
      'PAPER_CHANNEL_MISMATCH',
      `Build ${wantedBuild} kanalı "${entry.channel}", profil "${profile.paper.channel}" bekliyor.`,
    );
  }

  const server = entry.downloads?.['server:default'] ?? entry.downloads?.['application'];
  const downloadUrl = server?.url;
  const serviceSha = server?.checksums?.sha256?.toLowerCase();

  if (!downloadUrl || !serviceSha) {
    throw new PaperDownloadError(
      'PAPER_DOWNLOAD_FAILED',
      `Build ${wantedBuild} yanıtı indirme URL'si veya SHA-256 içermiyor.`,
    );
  }

  const expected = profile.paper.jar_sha256?.toLowerCase();
  if (expected && expected !== serviceSha) {
    throw new PaperDownloadError(
      'PAPER_JAR_CHECKSUM_INVALID',
      `Servis checksum'ı profildeki değerle eşleşmiyor.\n` +
        `  profil : ${expected}\n  servis : ${serviceSha}\n` +
        'Profil bayatlamış veya servis yanıtı değişmiş olabilir; ikisi de incelenmelidir.',
    );
  }

  return {
    minecraftVersion: version,
    build: wantedBuild,
    channel: entry.channel ?? profile.paper.channel,
    downloadUrl,
    sha256: serviceSha,
    filename: server.name ?? profile.paper.jar_filename ?? `paper-${version}-${wantedBuild}.jar`,
  };
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * JAR'ı cache'e indirir ve checksum'ı doğrular.
 *
 * Cache'te mevcut bir dosya varsa da checksum YENİDEN doğrulanır: cache dizini
 * host üzerinde başka process'ler tarafından değiştirilebilir ve
 * "bir kez doğruladık" varsayımı kanıt zincirini kırar.
 */
export async function downloadPaperJar(
  resolved: ResolvedBuild,
  cacheDir: string,
  fetchImpl: FetchLike,
): Promise<{ path: string; sha256: string; byteSize: number; fromCache: boolean }> {
  const target = join(cacheDir, resolved.filename);

  if (existsSync(target)) {
    const cached = await readFile(target);
    const actual = sha256(cached);
    if (actual === resolved.sha256) {
      return { path: target, sha256: actual, byteSize: cached.byteLength, fromCache: true };
    }
    // Bozuk/değiştirilmiş cache girdisi sessizce kullanılmaz.
    throw new PaperDownloadError(
      'PAPER_JAR_CHECKSUM_INVALID',
      `Cache'teki ${resolved.filename} checksum'ı uyuşmuyor.\n` +
        `  beklenen: ${resolved.sha256}\n  gerçek  : ${actual}`,
    );
  }

  if (!resolved.downloadUrl.startsWith('https://')) {
    throw new PaperDownloadError('PAPER_DOWNLOAD_FAILED', 'İndirme yalnızca HTTPS üzerinden yapılır.');
  }

  const response = await fetchImpl(resolved.downloadUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    throw new PaperDownloadError(
      'PAPER_DOWNLOAD_FAILED',
      `Paper JAR indirilemedi (HTTP ${response.status}).`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(bytes);

  if (actual !== resolved.sha256) {
    throw new PaperDownloadError(
      'PAPER_JAR_CHECKSUM_INVALID',
      `İndirilen JAR checksum'ı uyuşmuyor.\n` +
        `  beklenen: ${resolved.sha256}\n  gerçek  : ${actual}\n` +
        'Dosya diske YAZILMADI.',
    );
  }

  // Atomic yazma: temp + rename. Yarım kalan indirme cache'e sızmaz.
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.part`;
  await writeFile(temp, bytes, { mode: 0o600 });
  await rename(temp, target);

  return { path: target, sha256: actual, byteSize: bytes.byteLength, fromCache: false };
}
