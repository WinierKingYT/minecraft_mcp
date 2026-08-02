/**
 * ST-SNAPSHOT-001, UT-SNAPSHOT-* — kaynak snapshot değişmezliği.
 *
 * En kritik test: build sırasında değişen kaynak SESSİZCE tolere edilmez.
 * Aksi hâlde rapor, gerçekte derlenmeyen bir kaynak durumuna atıfta bulunur ve
 * KPI-09 (provenance) anlamsızlaşır.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRegistry, type RegisteredProject } from '../src/project-registry.js';
import {
  createSourceSnapshot,
  assertSnapshotUnchanged,
  fingerprintEntries,
  diffEntries,
  SnapshotError,
  DEFAULT_EXCLUDED_PATHS,
} from '../src/source-snapshot.js';

async function project(): Promise<{ root: string; project: RegisteredProject }> {
  const root = await mkdtemp(join(tmpdir(), 'snap-'));
  await mkdir(join(root, 'src', 'main'), { recursive: true });
  await writeFile(join(root, 'src', 'main', 'App.java'), 'class App {}');
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }');

  const reg = new ProjectRegistry();
  const registered = await reg.register('claim-plugin', {
    canonicalRoot: root,
    trustLevel: 'developer-workspace',
    allowedBackends: ['container'],
    defaultBackend: 'container',
  });
  return { root, project: registered };
}

test('snapshot manifest yol, boyut ve checksum taşır', async () => {
  const { project: p } = await project();
  const snapshot = await createSourceSnapshot(p);

  assert.match(snapshot.sourceSnapshotId, /^src_[0-9a-f]{24}$/);
  assert.equal(snapshot.projectId, 'claim-plugin');
  assert.equal(snapshot.entries.length, 2);

  const app = snapshot.entries.find((e) => e.path === 'src/main/App.java');
  assert.ok(app, 'yollar POSIX ayırıcılı olmalı');
  assert.equal(app.size, 'class App {}'.length);
  assert.match(app.sha256, /^[0-9a-f]{64}$/);
});

test('manifest fingerprint dizin okuma sırasından bağımsızdır', async () => {
  const { project: p } = await project();

  const first = await createSourceSnapshot(p);
  const second = await createSourceSnapshot(p);

  assert.equal(first.inputManifestSha256, second.inputManifestSha256);
  assert.notEqual(first.sourceSnapshotId, second.sourceSnapshotId, 'kimlikler ayrı kalmalı');
});

test('build sırasında değişen kaynak SOURCE_CHANGED_DURING_BUILD üretir', async () => {
  const { root, project: p } = await project();
  const snapshot = await createSourceSnapshot(p);

  // Build başladı... ve biri kaynağı değiştirdi.
  await writeFile(join(root, 'src', 'main', 'App.java'), 'class App { void x() {} }');

  await assert.rejects(
    () => assertSnapshotUnchanged(p, snapshot),
    (err: unknown) => {
      assert.ok(err instanceof SnapshotError);
      assert.equal(err.code, 'SOURCE_CHANGED_DURING_BUILD');
      assert.match(err.message, /~src\/main\/App\.java/, 'hangi dosyanın değiştiği raporlanmalı');
      return true;
    },
  );
});

test('yeni dosya da değişiklik sayılır', async () => {
  const { root, project: p } = await project();
  const snapshot = await createSourceSnapshot(p);

  await writeFile(join(root, 'Yeni.java'), 'class Yeni {}');

  await assert.rejects(
    () => assertSnapshotUnchanged(p, snapshot),
    (err: unknown) => err instanceof SnapshotError && /\+Yeni\.java/.test(err.message),
  );
});

test('silinen dosya da değişiklik sayılır', async () => {
  const { root, project: p } = await project();
  const snapshot = await createSourceSnapshot(p);

  await rm(join(root, 'build.gradle.kts'));

  await assert.rejects(
    () => assertSnapshotUnchanged(p, snapshot),
    (err: unknown) => err instanceof SnapshotError && /-build\.gradle\.kts/.test(err.message),
  );
});

test('değişiklik yoksa doğrulama geçer', async () => {
  const { project: p } = await project();
  const snapshot = await createSourceSnapshot(p);

  await assert.doesNotReject(() => assertSnapshotUnchanged(p, snapshot));
});

test('türetilmiş çıktı dizinleri snapshot dışındadır', async () => {
  const { root, project: p } = await project();

  await mkdir(join(root, 'build', 'libs'), { recursive: true });
  await writeFile(join(root, 'build', 'libs', 'out.jar'), 'derlenmiş');
  await mkdir(join(root, '.gradle'), { recursive: true });
  await writeFile(join(root, '.gradle', 'cache.bin'), 'cache');

  const snapshot = await createSourceSnapshot(p);

  assert.equal(
    snapshot.entries.some((e) => e.path.startsWith('build/') || e.path.startsWith('.gradle/')),
    false,
    'build ve .gradle snapshot dışında olmalı',
  );
  assert.ok(DEFAULT_EXCLUDED_PATHS.includes('build'));

  // Build çıktısı değişse bile snapshot geçerli kalmalı.
  await writeFile(join(root, 'build', 'libs', 'out.jar'), 'yeniden derlenmiş');
  await assert.doesNotReject(() => assertSnapshotUnchanged(p, snapshot));
});

test('snapshot içindeki symlink reddedilir', async (t) => {
  const { root, project: p } = await project();
  const outside = await mkdtemp(join(tmpdir(), 'outside-'));
  await writeFile(join(outside, 'secret.txt'), 'gizli');

  try {
    await symlink(outside, join(root, 'linked'), 'junction');
  } catch {
    t.skip('symlink/junction oluşturulamadı (yetki yok)');
    return;
  }

  await assert.rejects(
    () => createSourceSnapshot(p),
    (err: unknown) => err instanceof SnapshotError && err.code === 'SYMLINK_NOT_ALLOWED',
  );
});

test('dosya sayısı limiti aşılırsa snapshot alınmaz', async () => {
  const { root, project: p } = await project();
  for (let i = 0; i < 10; i++) {
    await writeFile(join(root, `f${i}.txt`), String(i));
  }

  await assert.rejects(
    () => createSourceSnapshot(p, { maxEntries: 5 }),
    (err: unknown) => err instanceof SnapshotError,
  );
});

test('kök fingerprint manifest fingerprint’ten ayrıdır', async () => {
  // Aynı içerik farklı bir projeden gelmiş olabilir; iki fingerprint ayrı
  // sorulara cevap verir.
  const a = await project();
  const b = await project();
  await writeFile(join(b.root, 'src', 'main', 'App.java'), 'class App {}');
  await writeFile(join(b.root, 'build.gradle.kts'), 'plugins { java }');

  const sa = await createSourceSnapshot(a.project);
  const sb = await createSourceSnapshot(b.project);

  assert.equal(sa.inputManifestSha256, sb.inputManifestSha256, 'aynı içerik aynı manifest');
  assert.notEqual(sa.canonicalRootFingerprint, sb.canonicalRootFingerprint, 'farklı kök farklı fingerprint');
});

test('fingerprintEntries alan değişimine duyarlıdır', () => {
  const base = [{ path: 'a.txt', size: 1, executable: false, sha256: 'x'.repeat(64) }];

  const changedSize = [{ ...base[0]!, size: 2 }];
  const changedExec = [{ ...base[0]!, executable: true }];
  const changedPath = [{ ...base[0]!, path: 'b.txt' }];

  const original = fingerprintEntries(base);
  assert.notEqual(fingerprintEntries(changedSize), original);
  assert.notEqual(fingerprintEntries(changedExec), original);
  assert.notEqual(fingerprintEntries(changedPath), original);
});

test('diffEntries ekleme, değişiklik ve silmeyi ayırır', () => {
  const before = [
    { path: 'a.txt', size: 1, executable: false, sha256: 'a'.repeat(64) },
    { path: 'b.txt', size: 1, executable: false, sha256: 'b'.repeat(64) },
  ];
  const after = [
    { path: 'a.txt', size: 1, executable: false, sha256: 'c'.repeat(64) },
    { path: 'd.txt', size: 1, executable: false, sha256: 'd'.repeat(64) },
  ];

  assert.deepEqual(diffEntries(before, after), ['+d.txt', '-b.txt', '~a.txt']);
});
