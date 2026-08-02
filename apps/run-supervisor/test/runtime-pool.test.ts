import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimePool } from '../src/runtime-pool.js';

describe('RuntimePool', () => {
  let pool: RuntimePool;

  afterEach(() => {
    pool?.destroy();
  });

  test('creates pool with default options', () => {
    pool = new RuntimePool();
    const status = pool.getStatus();
    assert.equal(status.total, 0);
    assert.equal(status.maxPoolSize, 5);
    assert.equal(status.maxIdleMs, 300_000);
    assert.equal(status.maxReuseCount, 10);
  });

  test('creates pool with custom options', () => {
    pool = new RuntimePool({
      maxPoolSize: 3,
      maxIdleMs: 60_000,
      maxReuseCount: 5,
    });
    const status = pool.getStatus();
    assert.equal(status.maxPoolSize, 3);
    assert.equal(status.maxIdleMs, 60_000);
    assert.equal(status.maxReuseCount, 5);
  });

  test('acquire creates new pool entry', () => {
    pool = new RuntimePool();
    const entry = pool.acquire('img-1', 'runtime-1', 'boot-1');
    assert.ok(entry.poolId.startsWith('pool_'));
    assert.equal(entry.runtimeImageId, 'img-1');
    assert.equal(entry.runtimeId, 'runtime-1');
    assert.equal(entry.bootId, 'boot-1');
    assert.equal(entry.state, 'ACQUIRED');
    assert.equal(entry.reuseCount, 0);
    assert.equal(pool.getStatus().acquired, 1);
  });

  test('acquire reuses existing idle entry', () => {
    pool = new RuntimePool();
    const first = pool.acquire('img-1', 'runtime-1', 'boot-1');
    pool.release(first.poolId);
    const second = pool.acquire('img-1', 'runtime-2', 'boot-2');
    assert.equal(first.poolId, second.poolId);
    assert.equal(second.runtimeId, 'runtime-2');
    assert.equal(second.bootId, 'boot-2');
    assert.equal(second.reuseCount, 1);
    assert.equal(pool.getStatus().idle, 0);
  });

  test('acquire does not reuse entry with different image', () => {
    pool = new RuntimePool();
    const first = pool.acquire('img-1', 'runtime-1', 'boot-1');
    pool.release(first.poolId);
    const second = pool.acquire('img-2', 'runtime-2', 'boot-2');
    assert.notEqual(first.poolId, second.poolId);
    assert.equal(pool.getStatus().idle, 1);
    assert.equal(pool.getStatus().acquired, 1);
  });

  test('acquire throws when pool is full', () => {
    pool = new RuntimePool({ maxPoolSize: 2 });
    pool.acquire('img-1', 'r1', 'b1');
    pool.acquire('img-2', 'r2', 'b2');
    assert.throws(() => pool.acquire('img-3', 'r3', 'b3'), /Pool is full/);
  });

  test('release changes state to IDLE', () => {
    pool = new RuntimePool();
    const entry = pool.acquire('img-1', 'r1', 'b1');
    pool.release(entry.poolId);
    assert.equal(entry.state, 'IDLE');
    assert.equal(pool.getStatus().idle, 1);
    assert.equal(pool.getStatus().acquired, 0);
  });

  test('release throws for non-existent entry', () => {
    pool = new RuntimePool();
    assert.throws(() => pool.release('non-existent'), /Pool entry not found/);
  });

  test('release throws for entry not in ACQUIRED state', () => {
    pool = new RuntimePool();
    const entry = pool.acquire('img-1', 'r1', 'b1');
    pool.release(entry.poolId);
    assert.throws(() => pool.release(entry.poolId), /Cannot release pool entry in state: IDLE/);
  });

  test('evict removes entry from pool', () => {
    pool = new RuntimePool();
    const entry = pool.acquire('img-1', 'r1', 'b1');
    pool.evict(entry.poolId);
    assert.equal(entry.state, 'EVICTED');
    assert.equal(pool.getStatus().total, 0);
  });

  test('evict emits evicted event', () => {
    pool = new RuntimePool();
    const entry = pool.acquire('img-1', 'r1', 'b1');
    let evicted = false;
    pool.on('evicted', () => { evicted = true; });
    pool.evict(entry.poolId);
    assert.ok(evicted);
  });

  test('release evicts when max reuse count exceeded', () => {
    pool = new RuntimePool({ maxReuseCount: 2 });
    const entry = pool.acquire('img-1', 'r1', 'b1');
    pool.release(entry.poolId); // reuseCount becomes 1
    pool.acquire('img-1', 'r2', 'b2'); // reuseCount becomes 2
    pool.release(entry.poolId); // reuseCount 2 >= maxReuseCount 2, so EVICTED
    assert.equal(entry.state, 'EVICTED');
    assert.equal(pool.getStatus().total, 0);
  });

  test('listByRuntimeImage returns matching entries', () => {
    pool = new RuntimePool();
    pool.acquire('img-1', 'r1', 'b1');
    pool.acquire('img-2', 'r2', 'b2');
    pool.acquire('img-1', 'r3', 'b3');
    const entries = pool.listByRuntimeImage('img-1');
    assert.equal(entries.length, 2);
  });

  test('getStatus returns correct counts', () => {
    pool = new RuntimePool();
    const e1 = pool.acquire('img-1', 'r1', 'b1');
    pool.acquire('img-2', 'r2', 'b2');
    pool.release(e1.poolId);
    const status = pool.getStatus();
    assert.equal(status.total, 2);
    assert.equal(status.idle, 1);
    assert.equal(status.acquired, 1);
  });

  test('destroy clears pool and removes listeners', () => {
    pool = new RuntimePool();
    pool.acquire('img-1', 'r1', 'b1');
    pool.on('evicted', () => {});
    pool.destroy();
    assert.equal(pool.getStatus().total, 0);
    assert.equal(pool.listenerCount('evicted'), 0);
  });
});
