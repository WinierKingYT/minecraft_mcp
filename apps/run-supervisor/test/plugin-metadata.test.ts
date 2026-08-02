/**
 * CT-PLUGIN-METADATA-001..003, ST-ARCHIVE-001..002
 *
 * ZIP okuyucu ve plugin.yml doğrulaması. JAR'lar testte elle üretilir; gerçek
 * bir Gradle build gerektirmez.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readZipEntries,
  readZipEntryByName,
  jarContainsClass,
  assertSafeEntryName,
  ArchiveError,
  DEFAULT_ZIP_LIMITS,
} from '../src/zip-reader.js';
import { inspectPluginJar, detectLoadingCycle } from '../src/plugin-metadata.js';

// ------------------------------------------------------------ ZIP üreteci

interface FileSpec {
  readonly name: string;
  readonly content: string | Buffer;
  readonly store?: boolean;
}

/** Minimal ZIP yazıcı — yalnızca test verisi üretmek için. */
function makeZip(files: readonly FileSpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const stored = file.store === true;
    const data = stored ? raw : deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuffer, eocd]);
}

async function jarFile(files: readonly FileSpec[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jar-'));
  const path = join(dir, 'plugin.jar');
  await writeFile(path, makeZip(files));
  return path;
}

const PLUGIN_YML = [
  'name: ClaimPlugin',
  "version: '1.0.0'",
  'main: com.example.ClaimPlugin',
  "api-version: '26.2'",
  '',
].join('\n');

const CLASS_ENTRY: FileSpec = { name: 'com/example/ClaimPlugin.class', content: 'CAFEBABE' };

// ------------------------------------------------------------------ ZIP

test('ZIP girdileri okunur ve içerik açılır', () => {
  const zip = makeZip([{ name: 'plugin.yml', content: PLUGIN_YML }, CLASS_ENTRY]);

  const entries = readZipEntries(zip);
  assert.equal(entries.length, 2);

  const content = readZipEntryByName(zip, 'plugin.yml');
  assert.equal(content?.toString('utf8'), PLUGIN_YML);
});

test('STORE ve DEFLATE yöntemlerinin ikisi de desteklenir', () => {
  const zip = makeZip([
    { name: 'stored.txt', content: 'saklanmis', store: true },
    { name: 'deflated.txt', content: 'sikistirilmis' },
  ]);

  assert.equal(readZipEntryByName(zip, 'stored.txt')?.toString('utf8'), 'saklanmis');
  assert.equal(readZipEntryByName(zip, 'deflated.txt')?.toString('utf8'), 'sikistirilmis');
});

test('ST-ARCHIVE-001: traversal içeren girdi adı reddedilir', () => {
  for (const name of ['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:\\Windows\\evil.txt']) {
    assert.throws(
      () => assertSafeEntryName(name),
      (err: unknown) => err instanceof ArchiveError && err.code === 'ARCHIVE_ENTRY_OUTSIDE_ROOT',
      `kabul edildi: ${name}`,
    );
  }

  assert.doesNotThrow(() => assertSafeEntryName('com/example/App.class'));
  assert.doesNotThrow(() => assertSafeEntryName('a..b/App.class'), '".." yalnızca tam segment olduğunda yasak');
});

test('null bayt içeren girdi adı reddedilir', () => {
  assert.throws(
    () => assertSafeEntryName('plugin\0.yml'),
    (err: unknown) => err instanceof ArchiveError && err.code === 'ARCHIVE_INVALID',
  );
});

test('ST-ARCHIVE-002: aşırı sıkıştırma oranı reddedilir', () => {
  // 1 MB sıfır, DEFLATE ile birkaç yüz bayta iner -> yüksek oran.
  const zip = makeZip([{ name: 'bomb.bin', content: Buffer.alloc(1024 * 1024, 0) }]);

  assert.throws(
    () => readZipEntries(zip, { ...DEFAULT_ZIP_LIMITS, maxCompressionRatio: 10 }),
    (err: unknown) => err instanceof ArchiveError && err.code === 'ARCHIVE_EXPANSION_LIMIT',
  );
});

test('girdi sayısı ve toplam boyut limitleri uygulanır', () => {
  const zip = makeZip([
    { name: 'a.txt', content: 'a' },
    { name: 'b.txt', content: 'b' },
  ]);

  assert.throws(
    () => readZipEntries(zip, { ...DEFAULT_ZIP_LIMITS, maxEntries: 1 }),
    (err: unknown) => err instanceof ArchiveError && err.code === 'ARCHIVE_EXPANSION_LIMIT',
  );
  assert.throws(
    () => readZipEntries(zip, { ...DEFAULT_ZIP_LIMITS, maxTotalBytes: 1 }),
    (err: unknown) => err instanceof ArchiveError && err.code === 'ARCHIVE_EXPANSION_LIMIT',
  );
});

test('bozuk arşiv açık hata üretir', () => {
  assert.throws(
    () => readZipEntries(Buffer.from('bu bir zip degil')),
    (err: unknown) => err instanceof ArchiveError && err.code === 'ARCHIVE_INVALID',
  );
});

test('jarContainsClass sınıf yolunu doğru çevirir', () => {
  const entries = readZipEntries(makeZip([CLASS_ENTRY]));

  assert.equal(jarContainsClass(entries, 'com.example.ClaimPlugin'), true);
  assert.equal(jarContainsClass(entries, 'com.example.Other'), false);
});

// -------------------------------------------------------- plugin metadata

const OPTIONS = { expectedApiVersion: '26.2' };

test('geçerli plugin.yml doğrulamayı geçer', async () => {
  const jar = await jarFile([{ name: 'plugin.yml', content: PLUGIN_YML }, CLASS_ENTRY]);

  const result = await inspectPluginJar(jar, OPTIONS);

  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.equal(result.metadata?.name, 'ClaimPlugin');
  assert.equal(result.metadata?.main, 'com.example.ClaimPlugin');
  assert.equal(result.metadata?.apiVersion, '26.2');
  assert.equal(result.metadata?.source, 'plugin.yml');
});

test('plugin.yml yoksa PLUGIN_METADATA_NOT_FOUND', async () => {
  const jar = await jarFile([CLASS_ENTRY]);

  const result = await inspectPluginJar(jar, OPTIONS);

  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === 'PLUGIN_METADATA_NOT_FOUND'));
});

test('main sınıfı JAR içinde yoksa PLUGIN_MAIN_CLASS_MISSING', async () => {
  const jar = await jarFile([{ name: 'plugin.yml', content: PLUGIN_YML }]);

  const result = await inspectPluginJar(jar, OPTIONS);

  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === 'PLUGIN_MAIN_CLASS_MISSING'));
});

test('eksik api-version PLUGIN_API_VERSION_MISSING üretir', async () => {
  const jar = await jarFile([
    { name: 'plugin.yml', content: 'name: X\nversion: 1\nmain: com.example.ClaimPlugin\n' },
    CLASS_ENTRY,
  ]);

  const result = await inspectPluginJar(jar, OPTIONS);
  assert.ok(result.findings.some((f) => f.code === 'PLUGIN_API_VERSION_MISSING'));
});

test('uyumsuz api-version PLUGIN_API_VERSION_INCOMPATIBLE üretir', async () => {
  const jar = await jarFile([
    { name: 'plugin.yml', content: PLUGIN_YML.replace('26.2', '1.21') },
    CLASS_ENTRY,
  ]);

  const result = await inspectPluginJar(jar, OPTIONS);

  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === 'PLUGIN_API_VERSION_INCOMPATIBLE'));
});

test('sayı olarak yazılmış api-version da okunur', async () => {
  // YAML `api-version: 26.2` değerini sayı olarak ayrıştırır.
  const jar = await jarFile([
    { name: 'plugin.yml', content: 'name: X\nversion: 1\nmain: com.example.ClaimPlugin\napi-version: 26.2\n' },
    CLASS_ENTRY,
  ]);

  const result = await inspectPluginJar(jar, OPTIONS);
  assert.equal(result.metadata?.apiVersion, '26.2');
});

test('ADR-0005: paper-plugin.yml deneysel destek kapalıyken reddedilir', async () => {
  const jar = await jarFile([{ name: 'paper-plugin.yml', content: PLUGIN_YML }, CLASS_ENTRY]);

  const result = await inspectPluginJar(jar, OPTIONS);

  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === 'PAPER_PLUGIN_EXPERIMENTAL_DISABLED'));
  assert.equal(result.hasPaperPluginYml, true);
});

test('feature flag açıkken paper-plugin.yml kabul edilir', async () => {
  const jar = await jarFile([{ name: 'paper-plugin.yml', content: PLUGIN_YML }, CLASS_ENTRY]);

  const result = await inspectPluginJar(jar, { ...OPTIONS, paperPluginExperimentalEnabled: true });

  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.equal(result.metadata?.source, 'paper-plugin.yml');
});

test('iki manifest birlikteyse örtük öncelik kuralı yoktur', async () => {
  const jar = await jarFile([
    { name: 'plugin.yml', content: PLUGIN_YML },
    { name: 'paper-plugin.yml', content: PLUGIN_YML },
    CLASS_ENTRY,
  ]);

  const result = await inspectPluginJar(jar, OPTIONS);
  assert.ok(result.findings.some((f) => f.code === 'PLUGIN_METADATA_AMBIGUOUS'));
});

test('duplicate plugin adı PLUGIN_NAME_CONFLICT üretir', async () => {
  const jar = await jarFile([{ name: 'plugin.yml', content: PLUGIN_YML }, CLASS_ENTRY]);

  const result = await inspectPluginJar(jar, { ...OPTIONS, otherPluginNames: ['ClaimPlugin'] });

  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === 'PLUGIN_NAME_CONFLICT'));
});

test('kendine bağımlılık PLUGIN_LOADING_CYCLE üretir', async () => {
  const jar = await jarFile([
    { name: 'plugin.yml', content: `${PLUGIN_YML}depend:\n  - ClaimPlugin\n` },
    CLASS_ENTRY,
  ]);

  const result = await inspectPluginJar(jar, OPTIONS);
  assert.ok(result.findings.some((f) => f.code === 'PLUGIN_LOADING_CYCLE'));
});

test('her bulgu önerilen aksiyon taşır (KPI-08)', async () => {
  const jar = await jarFile([{ name: 'plugin.yml', content: 'name: X\n' }]);

  const result = await inspectPluginJar(jar, OPTIONS);

  assert.ok(result.findings.length > 0);
  for (const finding of result.findings) {
    assert.ok(finding.suggestedAction.length >= 8, `${finding.code} aksiyon taşımıyor`);
  }
});

test('yükleme döngüsü tespit edilir', () => {
  const cycle = detectLoadingCycle(
    new Map([
      ['A', { depend: ['B'], softDepend: [] }],
      ['B', { depend: ['C'], softDepend: [] }],
      ['C', { depend: ['A'], softDepend: [] }],
    ]),
  );

  assert.ok(cycle, 'döngü bulunmalı');
  assert.ok(cycle.length >= 3);

  const acyclic = detectLoadingCycle(
    new Map([
      ['A', { depend: ['B'], softDepend: [] }],
      ['B', { depend: [], softDepend: [] }],
    ]),
  );
  assert.equal(acyclic, null);
});

test('gerçek Bridge JAR’ı doğrulamayı geçer', async (t) => {
  const { existsSync } = await import('node:fs');
  const jar = join(
    process.cwd(),
    '..',
    '..',
    'bridge',
    'paper',
    'build',
    'libs',
    'paper-bridge-0.1.0-prototype.0.jar',
  );
  if (!existsSync(jar)) {
    t.skip('bridge JAR bulunamadı; önce ./gradlew build çalıştırın');
    return;
  }

  const result = await inspectPluginJar(jar, OPTIONS);

  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.metadata?.name, 'PaperBridge');
  assert.equal(result.metadata?.main, 'io.github.mcpdev.bridge.PaperBridgePlugin');
  assert.equal(result.metadata?.apiVersion, '26.2');
  assert.ok(result.entryCount > 5, 'gerçek JAR birden fazla girdi içerir');
});
