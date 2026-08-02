/**
 * Mutation Tracker Testleri.
 *
 * MutationStore ve MutationHandler'ın doğru çalışmasını doğrular.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MutationStore, MutationHandler } from '../src/mutation-tracker.js';

// ------------------------------------------------------------ MutationStore

test('MutationStore: mutation oluşturur', () => {
  const store = new MutationStore();
  const mutation = store.create('world.set_block', 'runtime-1', {
    position: { world: 'test:overworld', x: 0, y: 64, z: 0 },
    material: 'minecraft:stone',
  });

  assert.ok(mutation.id.startsWith('mut_'));
  assert.equal(mutation.type, 'world.set_block');
  assert.equal(mutation.runtimeId, 'runtime-1');
  assert.equal(mutation.status, 'pending');
  assert.ok(mutation.idempotencyKey.startsWith('idem_'));
});

test('MutationStore: idempotency kontrolü', () => {
  const store = new MutationStore();
  const m1 = store.create('world.set_block', 'runtime-1', { test: 1 }, { idempotencyKey: 'key-1' });
  const m2 = store.create('world.set_block', 'runtime-1', { test: 2 }, { idempotencyKey: 'key-1' });

  assert.equal(m1.id, m2.id);
  assert.equal(store.size, 1);
});

test('MutationStore: farklı key ile yeni mutation', () => {
  const store = new MutationStore();
  const m1 = store.create('world.set_block', 'runtime-1', { test: 1 }, { idempotencyKey: 'key-1' });
  const m2 = store.create('world.set_block', 'runtime-1', { test: 2 }, { idempotencyKey: 'key-2' });

  assert.notEqual(m1.id, m2.id);
  assert.equal(store.size, 2);
});

test('MutationStore: durum güncelleme', () => {
  const store = new MutationStore();
  const mutation = store.create('world.set_block', 'runtime-1', { test: 1 });
  
  store.updateStatus(mutation.id, 'applied');
  assert.equal(store.get(mutation.id)?.status, 'applied');
});

test('MutationStore: hata ile durum güncelleme', () => {
  const store = new MutationStore();
  const mutation = store.create('world.set_block', 'runtime-1', { test: 1 });
  
  store.updateStatus(mutation.id, 'failed', 'Test hatası');
  const result = store.get(mutation.id);
  assert.equal(result?.status, 'failed');
  assert.equal(result?.error, 'Test hatası');
});

test('MutationStore: revert data kaydetme', () => {
  const store = new MutationStore();
  const mutation = store.create('world.set_block', 'runtime-1', { test: 1 });
  
  store.setRevertData(mutation.id, { previousMaterial: 'minecraft:air' });
  const result = store.get(mutation.id);
  assert.deepEqual(result?.revertData, { previousMaterial: 'minecraft:air' });
});

test('MutationStore: idempotency key ile getirme', () => {
  const store = new MutationStore();
  const mutation = store.create('world.set_block', 'runtime-1', { test: 1 }, { idempotencyKey: 'key-1' });
  
  const found = store.getByIdempotencyKey('key-1');
  assert.equal(found?.id, mutation.id);
  
  const notFound = store.getByIdempotencyKey('nonexistent');
  assert.equal(notFound, undefined);
});

test('MutationStore: runtime bazlı listeleme', () => {
  const store = new MutationStore();
  store.create('world.set_block', 'runtime-1', { test: 1 });
  store.create('world.set_block', 'runtime-1', { test: 2 });
  store.create('world.set_block', 'runtime-2', { test: 3 });

  const runtime1 = store.listByRuntime('runtime-1');
  assert.equal(runtime1.length, 2);

  const runtime2 = store.listByRuntime('runtime-2');
  assert.equal(runtime2.length, 1);

  const runtime3 = store.listByRuntime('runtime-3');
  assert.equal(runtime3.length, 0);
});

test('MutationStore: pending listeleme', () => {
  const store = new MutationStore();
  const m1 = store.create('world.set_block', 'runtime-1', { test: 1 });
  store.create('world.set_block', 'runtime-1', { test: 2 });
  store.create('world.set_block', 'runtime-1', { test: 3 });

  store.updateStatus(m1.id, 'applied');

  const pending = store.listPending();
  assert.equal(pending.length, 2);
  assert.ok(pending.every((m) => m.status === 'pending'));
});

test('MutationStore: boyut takibi', () => {
  const store = new MutationStore();
  assert.equal(store.size, 0);

  store.create('world.set_block', 'runtime-1', { test: 1 });
  assert.equal(store.size, 1);

  store.create('world.set_block', 'runtime-1', { test: 2 });
  assert.equal(store.size, 2);
});

// ------------------------------------------------------------ MutationHandler

test('MutationHandler: setBlock başarılı', async () => {
  const store = new MutationStore();
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  
  const handler = new MutationHandler(store, async (_rid, operation, args) => {
    calls.push({ operation, args });
    if (operation === 'get_block') {
      return { material: 'minecraft:air' };
    }
    return {};
  });

  const mutation = await handler.setBlock('runtime-1', {
    world: 'test:overworld',
    x: 0,
    y: 64,
    z: 0,
  }, 'minecraft:stone');

  assert.equal(mutation.status, 'applied');
  assert.equal(mutation.type, 'world.set_block');
  assert.deepEqual(mutation.revertData, { previousMaterial: 'minecraft:air' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.operation, 'get_block');
  assert.equal(calls[1]?.operation, 'set_block');
});

test('MutationHandler: setBlock hata durumunda', async () => {
  const store = new MutationStore();
  
  const handler = new MutationHandler(store, async () => {
    throw new Error('Bridge hatası');
  });

  await assert.rejects(
    () => handler.setBlock('runtime-1', { world: 'test', x: 0, y: 0, z: 0 }, 'stone'),
    { message: 'Bridge hatası' },
  );

  const mutations = store.listByRuntime('runtime-1');
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0]?.status, 'failed');
});

test('MutationHandler: setBlock idempotency', async () => {
  const store = new MutationStore();
  const calls: Array<{ operation: string }> = [];
  
  const handler = new MutationHandler(store, async (_rid, operation) => {
    calls.push({ operation });
    if (operation === 'get_block') {
      return { material: 'minecraft:air' };
    }
    return {};
  });

  const m1 = await handler.setBlock('runtime-1', { world: 'test', x: 0, y: 0, z: 0 }, 'stone', {
    idempotencyKey: 'key-1',
  });

  const m2 = await handler.setBlock('runtime-1', { world: 'test', x: 0, y: 0, z: 0 }, 'stone', {
    idempotencyKey: 'key-1',
  });

  assert.equal(m1.id, m2.id);
  assert.equal(calls.length, 2); // Sadece ilk seferinde çalışır
});

test('MutationHandler: revert başarılı', async () => {
  const store = new MutationStore();
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  
  const handler = new MutationHandler(store, async (_rid, operation, args) => {
    calls.push({ operation, args });
    if (operation === 'get_block') {
      return { material: 'minecraft:air' };
    }
    return {};
  });

  const mutation = await handler.setBlock('runtime-1', { world: 'test', x: 0, y: 0, z: 0 }, 'stone');
  await handler.revert(mutation.id);

  assert.equal(store.get(mutation.id)?.status, 'reverted');
  assert.equal(calls.length, 3);
  assert.equal(calls[2]?.operation, 'set_block');
  assert.equal(calls[2]?.args['material'], 'minecraft:air');
});

test('MutationHandler: revert bulunamadı', async () => {
  const store = new MutationStore();
  const handler = new MutationHandler(store, async () => ({}));

  await assert.rejects(
    () => handler.revert('nonexistent'),
    { code: 'EVIDENCE_NOT_FOUND' },
  );
});

test('MutationHandler: revert uygulanamaz durumda', async () => {
  const store = new MutationStore();
  const handler = new MutationHandler(store, async () => ({}));

  const mutation = store.create('world.set_block', 'runtime-1', { test: 1 });
  store.updateStatus(mutation.id, 'pending');

  await assert.rejects(
    () => handler.revert(mutation.id),
    { code: 'RUNTIME_INVALID_STATE' },
  );
});

test('MutationHandler: revertAll', async () => {
  const store = new MutationStore();
  const calls: Array<{ operation: string }> = [];
  
  const handler = new MutationHandler(store, async (_rid, operation) => {
    calls.push({ operation });
    if (operation === 'get_block') {
      return { material: 'minecraft:air' };
    }
    return {};
  });

  await handler.setBlock('runtime-1', { world: 'test', x: 0, y: 0, z: 0 }, 'stone');
  await handler.setBlock('runtime-1', { world: 'test', x: 1, y: 0, z: 0 }, 'dirt');

  await handler.revertAll('runtime-1');

  const mutations = store.listByRuntime('runtime-1');
  assert.ok(mutations.every((m) => m.status === 'reverted'));
});
