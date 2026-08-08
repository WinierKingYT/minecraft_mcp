/**
 * UT-GC-001 — Runtime Garbage Collector durum makinesi.
 *
 * RELEASED → RETENTION → (süre dolunca) DELETE_VALIDATION → DELETING → DELETED.
 * Silme güvenlik kapıları: runtime kökü içinde olmalı, marker dosyası olmalı,
 * çalışan process olmamalı, dizin yerinde olmalı.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeRegistry } from '../src/runtime-registry.js';
import { RuntimeGarbageCollector } from '../src/runtime-gc.js';
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
    token: 'tok',
    tokenFile: join(runtimeRoot, 'bridge-token'),
    markerFile: join(runtimeRoot, RUNTIME_MARKER_FILE),
    handshakeFile: join(runtimeRoot, 'handshake.json'),
    createdAt: new Date().toISOString(),
  };
}

/** RELEASED durumuna hazır bir kayıt kurar. */
function releasedEntry(registry: RuntimeRegistry, runtimeRoot: string) {
  const entry = registry.register(image(runtimeRoot));
  registry.updateState(entry, 'STOPPED');
  registry.updateState(entry, 'RELEASED');
  return entry;
}

describe('RuntimeGarbageCollector', () => {
  test('RELEASED kayıtlar ilk taramada RETENTION geçer', async () => {
    const base = await mkdtemp(join(tmpdir(), 'gc-root-'));
    const registry = new RuntimeRegistry();
    const entry = releasedEntry(registry, join(base, 'rt-1'));
    const gc = new RuntimeGarbageCollector({ registry, runtimeRootDir: base });

    const result = await gc.sweep();

    assert.equal(result.released, 1);
    assert.equal(entry.state, 'RETENTION');
    assert.equal(result.deleted, 0);
  });

  test('retention süresi dolan, markerlı dizin silinir ve kayıt kaldırılır', async () => {
    const base = await mkdtemp(join(tmpdir(), 'gc-root-'));
    const registry = new RuntimeRegistry();
    const runtimeRoot = join(base, 'rt-1');
    await mkdir(runtimeRoot, { recursive: true });
    const entry = releasedEntry(registry, runtimeRoot);
    await writeFile(join(runtimeRoot, RUNTIME_MARKER_FILE), 'marker');
    const gc = new RuntimeGarbageCollector({ registry, runtimeRootDir: base, retentionMs: 0 });

    const result = await gc.sweep();
    await gc.sweep();

    assert.equal(result.released, 1);
    assert.equal(existsSync(runtimeRoot), false, 'dizin silinmiş olmalı');
    assert.equal(registry.size, 0, 'kayıt DELETED sonrası kaldırılmış olmalı');
    assert.equal(entry.state, 'DELETED');
  });

  test('retention süresi dolmamış kayıt silinmez', async () => {
    const base = await mkdtemp(join(tmpdir(), 'gc-root-'));
    const registry = new RuntimeRegistry();
    const entry = releasedEntry(registry, join(base, 'rt-1'));
    const gc = new RuntimeGarbageCollector({ registry, runtimeRootDir: base, retentionMs: 60_000 });

    await gc.sweep();
    await gc.sweep();

    assert.equal(entry.state, 'RETENTION');
    assert.equal(registry.size, 1);
  });

  test('çalışan kayıt (running) asla silinmez', async () => {
    const base = await mkdtemp(join(tmpdir(), 'gc-root-'));
    const registry = new RuntimeRegistry();
    const runtimeRoot = join(base, 'rt-1');
    await mkdir(runtimeRoot, { recursive: true });
    const entry = releasedEntry(registry, runtimeRoot);
    await writeFile(join(runtimeRoot, RUNTIME_MARKER_FILE), 'marker');
    entry.running = {
      pid: 9999,
      javaExecutable: 'java',
      startedAtMs: Date.now(),
      runtimeMarkerSha256: 'x',
      handshake: { bridge_protocol: 1, bridge_boot_id: 'boot', server_instance_id: 'srv', bind_address: '127.0.0.1', port: 1, started_at_millis: Date.now() },
      handshakeFile: join(runtimeRoot, 'handshake.json'),
      logLines: [],
      client: null as never,
      process: null as never,
    };
    const gc = new RuntimeGarbageCollector({ registry, runtimeRootDir: base, retentionMs: 0 });

    await gc.sweep();
    const result = await gc.sweep();

    assert.equal(result.skipped, 1);
    assert.equal(existsSync(runtimeRoot), true);
    assert.equal(registry.size, 1);
  });

  test('dizin zaten yoksa kayıt olduğu gibi atılır (deleted sayılır)', async () => {
    const base = await mkdtemp(join(tmpdir(), 'gc-root-'));
    const registry = new RuntimeRegistry();
    releasedEntry(registry, join(base, 'rt-missing'));
    const gc = new RuntimeGarbageCollector({ registry, runtimeRootDir: base, retentionMs: 0 });

    await gc.sweep();
    const result = await gc.sweep();

    assert.equal(result.deleted, 1);
    assert.equal(registry.size, 0);
  });

  test('runtimeRootDir dışındaki dizin asla silinmez', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'gc-outside-'));
    const base = await mkdtemp(join(tmpdir(), 'gc-root-'));
    const registry = new RuntimeRegistry();
    const runtimeRoot = join(outside, 'rt-1');
    await mkdir(runtimeRoot, { recursive: true });
    releasedEntry(registry, runtimeRoot);
    await writeFile(join(runtimeRoot, RUNTIME_MARKER_FILE), 'marker');
    const gc = new RuntimeGarbageCollector({ registry, runtimeRootDir: base, retentionMs: 0 });

    await gc.sweep();
    const result = await gc.sweep();

    assert.equal(result.skipped, 1);
    assert.equal(existsSync(runtimeRoot), true, 'kök dışı dizin yerinde kalır');
    assert.equal(registry.size, 1);
  });

  test('marker dosyası olmayan dizin silinmez (FS-05)', async () => {
    const base = await mkdtemp(join(tmpdir(), 'gc-root-'));
    const registry = new RuntimeRegistry();
    const runtimeRoot = join(base, 'rt-1');
    await mkdir(runtimeRoot, { recursive: true });
    releasedEntry(registry, runtimeRoot);
    const gc = new RuntimeGarbageCollector({ registry, runtimeRootDir: base, retentionMs: 0 });

    await gc.sweep();
    const result = await gc.sweep();

    assert.equal(result.skipped, 1);
    assert.equal(existsSync(runtimeRoot), true);
    assert.equal(registry.size, 1);
  });

  test('taramalar sıralı yürütülür; her tarama sonrası onChange çağrılır', async () => {
    const base = await mkdtemp(join(tmpdir(), 'gc-root-'));
    const registry = new RuntimeRegistry();
    releasedEntry(registry, join(base, 'rt-1'));
    let changes = 0;
    const gc = new RuntimeGarbageCollector({
      registry,
      runtimeRootDir: base,
      retentionMs: 0,
      onChange: () => { changes++; },
    });

    await gc.sweep();
    await gc.sweep();

    assert.equal(changes, 2);
  });

  test('start/stop periyodik taramayı başlatır ve durdurur', () => {
    const base = process.cwd();
    const registry = new RuntimeRegistry();
    const gc = new RuntimeGarbageCollector({ registry, runtimeRootDir: base });
    gc.start();
    gc.start(); // ikinci start no-op
    gc.stop();
  });
});


