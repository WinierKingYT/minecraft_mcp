/**
 * CT-INT-V11-001 — V1.1 entegrasyon: RuntimePool + EventSubscriptionManager
 * birlikte çalışır.
 *
 * Üç V1.1 modülünün (pool, event subscription, scenario veri akışı) tek bir
 * akışta birlikte çalıştığını doğrular:
 *   1. pool.acquire ile bir runtime edinilir
 *   2. o runtime için events.subscribe açılır
 *   3. bridge (scenario veri kaynağı) olay üretir ve fetchEvents üzerinden akar
 *   4. events.list ile olaylar görünür, unsubscribe sonrası abonelik biter
 *   5. pool.release ile runtime serbest bırakılır
 *
 * Gerçek Paper GEREKTİRMEZ: bridge fetch sahtedir. Amaç üç modülün birlikte
 * çalıştığını kilitlemektir.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimePool } from '../src/runtime-pool.js';
import { EventSubscriptionManager } from '../src/event-subscription.js';

function makeEvent(sequence: number, type = 'player.place_block', actor = 'Alex') {
  return {
    sequence,
    event_id: `evt-${sequence}`,
    type,
    run_id: null,
    server_instance_id: 'srv-pool-1',
    bridge_boot_id: 'boot-1',
    correlation_id: null,
    causation_id: null,
    server_tick: 20 * sequence,
    occurred_at: new Date().toISOString(),
    actor,
    data: { knocked: true },
    source: 'bridge',
  };
}

function pollUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('pollUntil zaman aşımı'));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('CT-INT-V11-001: pool + event subscription + scenario akışı', () => {
  let pool: RuntimePool;
  let events: EventSubscriptionManager;
  let fetched: Array<Record<string, unknown>>;
  let fetchCount = 0;

  beforeEach(() => {
    pool = new RuntimePool({ maxPoolSize: 4, maxIdleMs: 60_000, maxReuseCount: 10 });
    fetched = [makeEvent(1), makeEvent(2, 'player.chat', 'Steve'), makeEvent(3)];
    events = new EventSubscriptionManager({
      pollIntervalMs: 30,
      fetchEvents: async (_bootId: string, after: number, limit: number) => {
        fetchCount += 1;
        return fetched
          .filter((e) => (e['sequence'] as number) > after)
          .slice(0, limit);
      },
    });
  });

  afterEach(() => {
    pool?.destroy();
  });

  test('runtime edinilir, olaylar toplanır, sonra serbest bırakılır', async () => {
    // 1. Pool'dan runtime edin
    const entry = pool.acquire('img-1', 'runtime-1', 'boot-1');
    assert.equal(entry.state, 'ACQUIRED');
    assert.equal(pool.getStatus().acquired, 1);

    // 2. Edinilen runtime'ın boot'u için subscription aç
    const sub = events.subscribe({
      runtimeId: 'runtime-1',
      bootId: entry.bootId,
      filter: { types: ['player.place_block'] },
    });
    assert.equal(sub.status, 'active');

    // 3. Scenario veri kaynağının ürettiği olaylar fetch üzerinden aksın
    await pollUntil(() => fetchCount >= 1, 500);

    // 4. Filtreye uyan olaylar aboneliğe ulaşmış olmalı
    const listed = events.listEvents({ subscriptionId: sub.subscriptionId });
    assert.ok(listed.events.length > 0, 'olaylar toplanmalı');
    assert.ok(listed.events.every((e) => e.type === 'player.place_block'), 'filtre uygulanmalı');

    // 5. Abonelik sonlandır
    const unsub = events.unsubscribe({ subscriptionId: sub.subscriptionId });
    assert.equal(unsub.status, 'unsubscribed');
    assert.equal(events.getActiveSubscriptions().length, 0);

    // 6. Runtime serbest bırak
    pool.release(entry.poolId);
    assert.equal(entry.state, 'IDLE');
    assert.equal(pool.getStatus().idle, 1);
    assert.equal(pool.getStatus().acquired, 0);
  });

  test('pool yeniden kullanımı ve yeni abonelik aynı akışta çalışır', async () => {
    const first = pool.acquire('img-1', 'runtime-1', 'boot-1');
    pool.release(first.poolId);

    // Aynı image için yeniden edinim aynı pool girişini döndürür
    const second = pool.acquire('img-1', 'runtime-1', 'boot-1');
    assert.equal(first.poolId, second.poolId);
    assert.equal(second.reuseCount, 1);

    const sub = events.subscribe({
      runtimeId: 'runtime-1',
      bootId: second.bootId,
      filter: { actor: 'Alex' },
    });
    await pollUntil(() => {
      const l = events.listEvents({ subscriptionId: sub.subscriptionId });
      return l.events.length >= 2;
    }, 500);

    const listed = events.listEvents({ subscriptionId: sub.subscriptionId });
    assert.ok(listed.events.every((e) => e.actor === 'Alex'), 'actor filtresi uygulanmalı');
    assert.ok(listed.events.some((e) => e.type === 'player.place_block'));

    events.unsubscribe({ subscriptionId: sub.subscriptionId });
    pool.release(second.poolId);
  });

  test('subscribe filter olmadan tüm olayları toplar (scenario ham akışı)', async () => {
    const entry = pool.acquire('img-2', 'runtime-2', 'boot-2');
    const sub = events.subscribe({ runtimeId: 'runtime-2', bootId: entry.bootId });

    await pollUntil(() => {
      const l = events.listEvents({ subscriptionId: sub.subscriptionId });
      return l.events.length >= 3;
    }, 500);

    const listed = events.listEvents({ subscriptionId: sub.subscriptionId });
    assert.equal(listed.events.length, 3, 'tüm olaylar toplanmalı');

    events.unsubscribe({ subscriptionId: sub.subscriptionId });
    pool.release(entry.poolId);
  });
});
