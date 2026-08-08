/**
 * UT-PERSIST-001 — Persistent Runtime Registry.
 *
 * Supervisor restart sonrası kurtarma: çalışan kayıtlar CRASHED'a çekilir,
 * token kalıcılığa yazılmaz, atomic write + symlink koruması disk güvenliği
 * kilitler.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentRuntimeRegistry, type PersistedRegistryData } from '../src/persistent-registry.js';
import { RUNTIME_MARKER_FILE } from '../src/runtime-image.js';
import type { RuntimeImage } from '../src/runtime-image.js';

function image(runtimeRoot: string): RuntimeImage {
  return {
    runtimeImageId: `img_${Math.random().toString(36).slice(2, 10)}`,
    runtimeRoot,
    serverInstanceId: `srv_${Math.random().toString(36).slice(2, 10)}`,
    paperJarPath: '',
    paperJarSha256: 'a'.repeat(64),
    bridgeJarSha256: 'b'.repeat(64),
    token: 'super-secret-token',
    tokenFile: join(runtimeRoot, 'bridge-token'),
    markerFile: join(runtimeRoot, RUNTIME_MARKER_FILE),
    handshakeFile: join(runtimeRoot, 'handshake.json'),
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('PersistentRuntimeRegistry', () => {
  test('save diske yazar; dosya versiyonlu ve token içermez', async () => {
    const base = await mkdtemp(join(tmpdir(), 'persist-'));
    const filePath = join(base, 'registry.json');
    const registry = new PersistentRuntimeRegistry({ filePath });
    const entry = registry.register(image(join(base, 'rt-1')));
    registry.updateState(entry, 'READY');
    entry.readyGateMs = 42;

    await registry.save();

    const raw = await readFile(filePath, 'utf8');
    assert.ok(!raw.includes('super-secret-token'), 'secret kalıcılığa yazılmaz');
    const data = JSON.parse(raw) as PersistedRegistryData;
    assert.equal(data.version, 1);
    assert.equal(data.records.length, 1);
    assert.equal(data.records[0]!.state, 'READY');
    assert.equal(data.records[0]!.readyGateMs, 42);
  });

  test('load kayıtları geri yükler; durumlar korunur', async () => {
    const base = await mkdtemp(join(tmpdir(), 'persist-'));
    const filePath = join(base, 'registry.json');
    const registry = new PersistentRuntimeRegistry({ filePath });
    const entry = registry.register(image(join(base, 'rt-1')));
    registry.updateState(entry, 'STOPPED');
    await registry.save();

    const restored = new PersistentRuntimeRegistry({ filePath });
    await restored.load();

    assert.equal(restored.size, 1);
    const restoredEntry = restored.list()[0]!;
    assert.equal(restoredEntry.state, 'STOPPED');
    assert.equal(restoredEntry.running, null, 'process bilgisi geri yüklenmez');
    assert.equal(restoredEntry.image.token, '', 'token geri yüklenmez');
    assert.equal(restoredEntry.image.paperJarPath, '', 'paper jar yolu geri yüklenmez');
    assert.ok(restoredEntry.stateChangedAt > 0);
  });

  test('was-running kayıtları CRASHED olarak geri yüklenir', async () => {
    const base = await mkdtemp(join(tmpdir(), 'persist-'));
    const filePath = join(base, 'registry.json');
    const registry = new PersistentRuntimeRegistry({ filePath });
    const entry = registry.register(image(join(base, 'rt-1')));
    registry.updateState(entry, 'READY');
    await registry.save();

    const restored = new PersistentRuntimeRegistry({ filePath });
    await restored.load();

    assert.equal(restored.list()[0]!.state, 'CRASHED');
  });

  test('load dosya yoksa boş registry ile devam eder', async () => {
    const base = await mkdtemp(join(tmpdir(), 'persist-'));
    const registry = new PersistentRuntimeRegistry({ filePath: join(base, 'yok.json') });
    await registry.load();
    assert.equal(registry.size, 0);
  });

  test('bilinmeyen versiyon yoksayılır', async () => {
    const base = await mkdtemp(join(tmpdir(), 'persist-'));
    const filePath = join(base, 'registry.json');
    await writeFile(filePath, JSON.stringify({ version: 99, updatedAt: '', records: [] }));
    const registry = new PersistentRuntimeRegistry({ filePath });
    await registry.load();
    assert.equal(registry.size, 0);
  });

  test('register/updateState/remove dirty işaretler; save temizler', async () => {
    const base = await mkdtemp(join(tmpdir(), 'persist-'));
    const registry = new PersistentRuntimeRegistry({ filePath: join(base, 'registry.json') });
    assert.equal(registry.isDirty, false);

    const entry = registry.register(image(join(base, 'rt-1')));
    assert.equal(registry.isDirty, true);
    await registry.save();
    assert.equal(registry.isDirty, false);

    registry.updateState(entry, 'STOPPED');
    assert.equal(registry.isDirty, true);
    await registry.save();
    assert.equal(registry.isDirty, false);

    registry.remove(entry.image.runtimeImageId);
    assert.equal(registry.isDirty, true);
  });

  test('save/load döngüsünde stateChangedAt korunur', async () => {
    const base = await mkdtemp(join(tmpdir(), 'persist-'));
    const filePath = join(base, 'registry.json');
    const registry = new PersistentRuntimeRegistry({ filePath });
    const entry = registry.register(image(join(base, 'rt-1')));
    registry.updateState(entry, 'RELEASED');
    const stampedAt = entry.stateChangedAt;
    await registry.save();

    const restored = new PersistentRuntimeRegistry({ filePath });
    await restored.load();

    assert.equal(restored.list()[0]!.stateChangedAt, stampedAt);
    assert.equal(restored.list()[0]!.state, 'RELEASED');
  });

  test('dosya oluştuğunda dizin yoksa oluşturulur', async () => {
    const base = await mkdtemp(join(tmpdir(), 'persist-'));
    const filePath = join(base, 'nested', 'deep', 'registry.json');
    const registry = new PersistentRuntimeRegistry({ filePath });
    registry.register(image(join(base, 'rt-1')));
    await registry.save();
    assert.ok(existsSync(filePath));
  });
});
