/**
 * CT-PAPER-DOWNLOAD-001 — Downloads Service sözleşmesi ve checksum zorunluluğu.
 *
 * Testler gerçek ağa ÇIKMAZ: fetch enjekte edilir. Amaç, hangi durumda hangi
 * hata kodunun üretildiğini kilitlemek — "indirme çalışıyor mu" değil,
 * "bozuk indirme reddediliyor mu".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveBuild,
  downloadPaperJar,
  sha256,
  USER_AGENT,
  PaperDownloadError,
  type FetchLike,
} from '../src/paper-download.js';
import type { CompatibilityProfile } from '../src/compatibility.js';

const JAR_BYTES = new TextEncoder().encode('fake paper jar contents');
const JAR_SHA = sha256(JAR_BYTES);

function profileWith(overrides: Partial<CompatibilityProfile['paper']> = {}): CompatibilityProfile {
  return {
    id: 'test-profile',
    verification: { status: 'verified' },
    minecraft: { version: '26.2' },
    paper: {
      channel: 'STABLE',
      build: 84,
      api_coordinate: 'io.papermc.paper:paper-api:26.2.build.84-stable',
      api_version: '26.2',
      jar_sha256: JAR_SHA,
      jar_filename: 'paper-26.2-84.jar',
      hardcoded_download_url_allowed: false,
      ...overrides,
    },
    java: { runtime_major: 25, toolchain_major: 25 },
    node: { version: '24.18.1' },
    gradle: { wrapper_version: '9.6.1', distribution_sha256: null },
    mcp: { protocol_version: '2026-07-28', transport: 'stdio' },
    protocols: { bridge: 1 },
  } as CompatibilityProfile;
}

/** Uint8Array -> bağımsız ArrayBuffer (SharedArrayBuffer sızmasını engeller). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

interface StubOptions {
  readonly builds?: unknown;
  readonly status?: number;
  readonly jarBytes?: Uint8Array;
}

function stubFetch(opts: StubOptions = {}): { fetch: FetchLike; seenHeaders: Record<string, string>[] } {
  const seenHeaders: Record<string, string>[] = [];
  const fetch: FetchLike = async (url, init) => {
    seenHeaders.push(init?.headers ?? {});
    if (url.includes('/builds')) {
      const status = opts.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () =>
          opts.builds ?? [
            {
              id: 84,
              channel: 'STABLE',
              downloads: {
                'server:default': {
                  name: 'paper-26.2-84.jar',
                  url: 'https://fill-data.papermc.io/v1/objects/abc/paper-26.2-84.jar',
                  checksums: { sha256: JAR_SHA },
                },
              },
            },
          ],
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    const bytes = opts.jarBytes ?? JAR_BYTES;
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      arrayBuffer: async () => toArrayBuffer(bytes),
    };
  };
  return { fetch, seenHeaders };
}

test('User-Agent yazılımı tanımlar ve iletişim adresi içerir', () => {
  assert.match(USER_AGENT, /minecraft-plugin-dev-mcp\//, 'UA yazılımı tanımlamalı');
  assert.match(USER_AGENT, /https?:\/\/|@/, 'UA iletişim adresi içermeli');
  assert.doesNotMatch(USER_AGENT, /^(curl|wget|node|axios)/i, 'jenerik UA reddedilir');
});

test('build çözümlemesi User-Agent gönderir', async () => {
  const { fetch, seenHeaders } = stubFetch();
  await resolveBuild(profileWith(), fetch);
  assert.equal(seenHeaders[0]?.['User-Agent'], USER_AGENT);
});

test('indirme URL\'si servis yanıtından çözülür, sabit metinden değil', async () => {
  const { fetch } = stubFetch();
  const resolved = await resolveBuild(profileWith(), fetch);
  assert.equal(resolved.downloadUrl, 'https://fill-data.papermc.io/v1/objects/abc/paper-26.2-84.jar');
  assert.equal(resolved.sha256, JAR_SHA);
});

test('build bulunamazsa PAPER_BUILD_NOT_FOUND', async () => {
  const { fetch } = stubFetch({ builds: [{ id: 87, channel: 'STABLE' }] });
  await assert.rejects(
    () => resolveBuild(profileWith(), fetch),
    (e: unknown) => e instanceof PaperDownloadError && e.code === 'PAPER_BUILD_NOT_FOUND',
  );
});

test('kanal uyuşmazlığı PAPER_CHANNEL_MISMATCH üretir', async () => {
  const { fetch } = stubFetch({
    builds: [
      {
        id: 84,
        channel: 'ALPHA',
        downloads: { 'server:default': { url: 'https://x/y.jar', checksums: { sha256: JAR_SHA } } },
      },
    ],
  });
  await assert.rejects(
    () => resolveBuild(profileWith(), fetch),
    (e: unknown) => e instanceof PaperDownloadError && e.code === 'PAPER_CHANNEL_MISMATCH',
  );
});

test('servis checksum\'ı profille uyuşmazsa reddedilir', async () => {
  const { fetch } = stubFetch();
  await assert.rejects(
    () => resolveBuild(profileWith({ jar_sha256: 'f'.repeat(64) }), fetch),
    (e: unknown) => e instanceof PaperDownloadError && e.code === 'PAPER_JAR_CHECKSUM_INVALID',
  );
});

test('doğru checksum ile indirme başarılı ve dosya yazılır', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'paper-dl-'));
  const { fetch } = stubFetch();
  const resolved = await resolveBuild(profileWith(), fetch);
  const result = await downloadPaperJar(resolved, dir, fetch);

  assert.equal(result.sha256, JAR_SHA);
  assert.equal(result.fromCache, false);
  assert.deepEqual(new Uint8Array(await readFile(result.path)), JAR_BYTES);
});

test('checksum uyuşmazsa dosya DİSKE YAZILMAZ', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'paper-dl-'));
  const { fetch } = stubFetch({ jarBytes: new TextEncoder().encode('tampered') });
  const resolved = await resolveBuild(profileWith(), fetch);

  await assert.rejects(
    () => downloadPaperJar(resolved, dir, fetch),
    (e: unknown) => e instanceof PaperDownloadError && e.code === 'PAPER_JAR_CHECKSUM_INVALID',
  );

  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(join(dir, 'paper-26.2-84.jar')), false, 'bozuk indirme cache\'e sızmamalı');
});

test('cache girdisi her kullanımda YENİDEN doğrulanır', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'paper-dl-'));
  const { fetch } = stubFetch();
  const resolved = await resolveBuild(profileWith(), fetch);

  // Geçerli cache girdisi
  await writeFile(join(dir, 'paper-26.2-84.jar'), JAR_BYTES);
  const hit = await downloadPaperJar(resolved, dir, fetch);
  assert.equal(hit.fromCache, true);

  // Cache host üzerinde değiştirilirse kullanılmaz
  await writeFile(join(dir, 'paper-26.2-84.jar'), new TextEncoder().encode('tampered cache'));
  await assert.rejects(
    () => downloadPaperJar(resolved, dir, fetch),
    (e: unknown) => e instanceof PaperDownloadError && e.code === 'PAPER_JAR_CHECKSUM_INVALID',
  );
});
