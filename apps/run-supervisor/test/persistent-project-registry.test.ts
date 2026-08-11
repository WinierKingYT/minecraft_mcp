/**
 * UT-PROJECT-REGISTER-001 (kalıcılık) — PersistentProjectRegistry.
 *
 * Kayıtların disk'e yazılması, restart'ta geri yüklenmesi ve bozuk
 * durumların (corrupt JSON, yanlış version, geri yüklenemeyen kayıt)
 * registry'nin tamamını çökertmemesi.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentProjectRegistry } from '../src/persistent-project-registry.js';

const TRUST = {
  trustLevel: 'developer-workspace' as const,
  allowedBackends: ['trusted-local', 'container'] as const,
  defaultBackend: 'trusted-local' as const,
};

const EVENTS: string[] = [];
function log(level: string, event: string): void {
  EVENTS.push(`${level} ${event}`);
}

test('register sonrası save, yeni instance load ile kayıtları geri getirir', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ppr-test-'));
  const root = join(base, 'proje');
  await mkdir(root, { recursive: true });
  const file = join(base, 'project-registry.json');

  const first = new PersistentProjectRegistry({ filePath: file, log });
  const project = await first.register('demo', {
    canonicalRoot: root,
    ...TRUST,
  });
  assert.ok(first.isDirty);
  await first.flush();
  assert.equal(first.isDirty, false);
  assert.ok((await readFile(file, 'utf8')).length > 0, 'disk dosyası oluşmalı');

  const second = new PersistentProjectRegistry({ filePath: file, log });
  await second.load();
  assert.equal(second.isLoaded, true);
  const restored = second.get('demo');
  assert.equal(restored.canonicalRoot, project.canonicalRoot);
  assert.equal(restored.trustLevel, 'developer-workspace');
  assert.deepEqual(restored.allowedBackends, ['trusted-local', 'container']);
  assert.equal(restored.registeredAt, project.registeredAt, 'registeredAt korunmalı');
});

test('dosya yoksa load no-op olur ve kayıt yoktur', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ppr-test-'));
  const registry = new PersistentProjectRegistry({ filePath: join(base, 'yok.json'), log });
  await registry.load();
  assert.equal(registry.isLoaded, true);
  assert.equal(registry.list().length, 0);
});

test('corrupt JSON load hatasında çökmez; registry boş kalır', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ppr-test-'));
  const file = join(base, 'registry.json');
  await writeFile(file, '{ bozuk json', 'utf8');

  const registry = new PersistentProjectRegistry({ filePath: file, log });
  await registry.load();
  assert.equal(registry.list().length, 0);
  assert.ok(EVENTS.some((e) => e.includes('project_registry.load_failed')), 'hata loglanmalı');
});

test('desteklenmeyen version kayıtlarını yüklemeyi atlar', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ppr-test-'));
  const file = join(base, 'registry.json');
  await writeFile(
    file,
    JSON.stringify({ version: 999, updatedAt: new Date().toISOString(), projects: [] }),
    'utf8',
  );

  const registry = new PersistentProjectRegistry({ filePath: file, log });
  await registry.load();
  assert.equal(registry.list().length, 0);
  assert.ok(EVENTS.some((e) => e.includes('project_registry.invalid_version')));
});

test('geri yüklenemeyen kayıt (kök silinmiş) atlanır, diğerleri gelir', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ppr-test-'));
  const alive = join(base, 'varolan');
  const gone = join(base, 'silinen');
  await mkdir(alive, { recursive: true });
  await mkdir(gone, { recursive: true });

  const file = join(base, 'registry.json');
  const seed = new PersistentProjectRegistry({ filePath: file, log });
  await seed.register('a', { canonicalRoot: alive, ...TRUST });
  await seed.register('b', { canonicalRoot: gone, ...TRUST });
  await seed.save();

  await rm(gone, { recursive: true, force: true });

  const registry = new PersistentProjectRegistry({ filePath: file, log });
  await registry.load();
  assert.ok(EVENTS.some((e) => e.includes('project_registry.restore_skipped')), 'atlanan kayıt loglanmalı');
  assert.deepEqual(registry.list().map((p) => p.id), ['a']);
});

test('restore sırasında bozuk backend config kaydı atlanır', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ppr-test-'));
  const root = join(base, 'proje');
  await mkdir(root, { recursive: true });
  const file = join(base, 'registry.json');

  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      projects: [
        {
          id: 'iyi',
          canonicalRoot: root,
          trustLevel: 'developer-workspace',
          allowedBackends: ['trusted-local'],
          defaultBackend: 'trusted-local',
          registeredAt: new Date().toISOString(),
        },
        {
          id: 'kotu',
          canonicalRoot: root,
          trustLevel: 'developer-workspace',
          allowedBackends: ['trusted-local'],
          defaultBackend: 'container',
          registeredAt: new Date().toISOString(),
        },
      ],
    }),
    'utf8',
  );

  const registry = new PersistentProjectRegistry({ filePath: file, log });
  await registry.load();
  assert.deepEqual(registry.list().map((p) => p.id), ['iyi']);
});

test('sync replace (aynı id) yeni kaydı yazar', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ppr-test-'));
  const root = join(base, 'proje');
  await mkdir(root, { recursive: true });
  const file = join(base, 'registry.json');

  const registry = new PersistentProjectRegistry({ filePath: file, log });
  await registry.register('demo', { canonicalRoot: root, ...TRUST });
  await registry.save();

  const other = join(base, 'diger');
  await mkdir(other, { recursive: true });
  await registry.register('demo', {
    canonicalRoot: other,
    trustLevel: 'developer-workspace',
    allowedBackends: ['trusted-local'],
    defaultBackend: 'trusted-local',
  });
  await registry.save();

  const reloaded = new PersistentProjectRegistry({ filePath: file, log });
  await reloaded.load();
  assert.equal(reloaded.get('demo').canonicalRoot, other);
});
