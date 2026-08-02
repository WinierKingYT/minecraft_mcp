/**
 * Event subscription tests — V1.1 event-driven architecture.
 *
 * Tests the EventSubscriptionManager:
 *   - Subscribe/unsubscribe lifecycle
 *   - Event filtering (by type, actor)
 *   - Buffer limits and overflow
 *   - TTL expiration
 *   - Concurrent subscriptions
 *   - Event delivery ordering
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  EventSubscriptionManager,
  type EventSubscriptionManagerOptions,
} from '../src/event-subscription.js';
import {
  MAX_SUBSCRIPTIONS_PER_RUNTIME,
} from '@mcpdev/contracts';

// ─── Helpers ─────────────────────────────────────────────────────────

function createMockEvent(sequence: number, type = 'player.chat', actor?: string) {
  return {
    sequence,
    event_id: `evt-${sequence}`,
    type,
    run_id: null,
    server_instance_id: 'test-server',
    bridge_boot_id: 'boot-1',
    correlation_id: null,
    causation_id: null,
    server_tick: 20 * sequence,
    occurred_at: new Date().toISOString(),
    actor: actor ?? null,
    data: { message: `Event ${sequence}` },
    source: 'bridge',
  };
}

function createMockFetcher(events: Array<Record<string, unknown>> = []) {
  let callCount = 0;
  return {
    fetch: async (_bootId: string, after: number, limit: number) => {
      callCount++;
      return events.filter((e) => (e['sequence'] as number) > after).slice(0, limit);
    },
    getCallCount: () => callCount,
  };
}

function createOptions(overrides: Partial<EventSubscriptionManagerOptions> = {}): EventSubscriptionManagerOptions {
  const mockFetcher = createMockFetcher();
  return {
    fetchEvents: mockFetcher.fetch,
    pollIntervalMs: 50, // Fast polling for tests
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('EventSubscriptionManager: subscribe/unsubscribe', () => {
  let manager: EventSubscriptionManager;

  beforeEach(() => {
    manager = new EventSubscriptionManager(createOptions());
  });

  afterEach(() => {
    manager.destroy();
  });

  test('subscribe creates subscription with active status', () => {
    const result = manager.subscribe({
      runtimeId: 'runtime-1',
      bootId: 'boot-1',
    });

    assert.equal(result.status, 'active');
    assert.ok(result.subscriptionId);
    assert.equal(result.eventsReceived, 0);
  });

  test('unsubscribe removes subscription', () => {
    const { subscriptionId } = manager.subscribe({
      runtimeId: 'runtime-1',
      bootId: 'boot-1',
    });

    const result = manager.unsubscribe({ subscriptionId });

    assert.equal(result.status, 'unsubscribed');
    assert.equal(result.eventsReceived, 0);
  });

  test('unsubscribe non-existent subscription throws', () => {
    assert.throws(
      () => manager.unsubscribe({ subscriptionId: 'non-existent' }),
      (err: Error) => err.message.includes('not found'),
    );
  });

  test('getActiveSubscriptions returns active subscriptions', () => {
    manager.subscribe({ runtimeId: 'runtime-1', bootId: 'boot-1' });
    manager.subscribe({ runtimeId: 'runtime-2', bootId: 'boot-2' });

    const active = manager.getActiveSubscriptions();

    assert.equal(active.length, 2);
    assert.ok(active[0]?.subscriptionId);
    assert.ok(active[1]?.subscriptionId);
  });
});

describe('EventSubscriptionManager: event filtering', () => {
  let manager: EventSubscriptionManager;

  afterEach(() => {
    manager?.destroy();
  });

  test('filter by event type', async () => {
    const events = [
      createMockEvent(1, 'player.chat'),
      createMockEvent(2, 'player.join'),
      createMockEvent(3, 'player.chat'),
    ];

    manager = new EventSubscriptionManager(
      createOptions({
        fetchEvents: async () => events,
      }),
    );

    const { subscriptionId } = manager.subscribe({
      runtimeId: 'runtime-1',
      bootId: 'boot-1',
      filter: { types: ['player.chat'] },
    });

    // Wait for poll
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = manager.listEvents({ subscriptionId });

    assert.equal(result.events.length, 2);
    assert.ok(result.events.every((e) => e.type === 'player.chat'));
  });

  test('filter by actor', async () => {
    const events = [
      createMockEvent(1, 'player.chat', 'player1'),
      createMockEvent(2, 'player.chat', 'player2'),
      createMockEvent(3, 'player.chat', 'player1'),
    ];

    manager = new EventSubscriptionManager(
      createOptions({
        fetchEvents: async () => events,
      }),
    );

    const { subscriptionId } = manager.subscribe({
      runtimeId: 'runtime-1',
      bootId: 'boot-1',
      filter: { actor: 'player1' },
    });

    // Wait for poll
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = manager.listEvents({ subscriptionId });

    assert.equal(result.events.length, 2);
    assert.ok(result.events.every((e) => e.actor === 'player1'));
  });

  test('exclude event types', async () => {
    const events = [
      createMockEvent(1, 'player.chat'),
      createMockEvent(2, 'player.join'),
      createMockEvent(3, 'player.chat'),
    ];

    manager = new EventSubscriptionManager(
      createOptions({
        fetchEvents: async () => events,
      }),
    );

    const { subscriptionId } = manager.subscribe({
      runtimeId: 'runtime-1',
      bootId: 'boot-1',
      filter: { excludeTypes: ['player.join'] },
    });

    // Wait for poll
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = manager.listEvents({ subscriptionId });

    assert.equal(result.events.length, 2);
    assert.ok(result.events.every((e) => e.type !== 'player.join'));
  });
});

describe('EventSubscriptionManager: buffer limits', () => {
  let manager: EventSubscriptionManager;

  afterEach(() => {
    manager?.destroy();
  });

  test('respects maxEventsPerSubscription', async () => {
    const events = Array.from({ length: 100 }, (_, i) => createMockEvent(i + 1));

    manager = new EventSubscriptionManager(
      createOptions({
        fetchEvents: async () => events,
        maxEventsPerSubscription: 10,
      }),
    );

    const { subscriptionId } = manager.subscribe({
      runtimeId: 'runtime-1',
      bootId: 'boot-1',
    });

    // Wait for poll
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = manager.listEvents({ subscriptionId });

    assert.equal(result.events.length, 10);
  });

  test('listEvents pagination works', async () => {
    const events = Array.from({ length: 50 }, (_, i) => createMockEvent(i + 1));

    manager = new EventSubscriptionManager(
      createOptions({
        fetchEvents: async () => events,
      }),
    );

    const { subscriptionId } = manager.subscribe({
      runtimeId: 'runtime-1',
      bootId: 'boot-1',
    });

    // Wait for poll
    await new Promise((resolve) => setTimeout(resolve, 100));

    // First page
    const page1 = manager.listEvents({ subscriptionId, limit: 10 });
    assert.equal(page1.events.length, 10);
    assert.equal(page1.hasMore, true);
    assert.ok(page1.nextCursor);

    // Second page
    const page2 = manager.listEvents({
      subscriptionId,
      after: page1.nextCursor!,
      limit: 10,
    });
    assert.equal(page2.events.length, 10);
    assert.ok(page2.events[0]!.sequence > page1.nextCursor!);
  });
});

describe('EventSubscriptionManager: TTL expiration', () => {
  test('subscription expires after TTL', async () => {
    const manager = new EventSubscriptionManager(
      createOptions({
        defaultTtlMs: 50, // 50ms for testing
      }),
    );

    manager.subscribe({
      runtimeId: 'runtime-1',
      bootId: 'boot-1',
    });

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 100));

    const active = manager.getActiveSubscriptions();
    assert.equal(active.length, 0);

    manager.destroy();
  });
});

describe('EventSubscriptionManager: concurrent subscriptions', () => {
  let manager: EventSubscriptionManager;

  afterEach(() => {
    manager?.destroy();
  });

  test('multiple subscriptions for same runtime', () => {
    manager = new EventSubscriptionManager(createOptions());

    const sub1 = manager.subscribe({ runtimeId: 'runtime-1', bootId: 'boot-1' });
    manager.subscribe({ runtimeId: 'runtime-1', bootId: 'boot-1' });
    manager.subscribe({ runtimeId: 'runtime-1', bootId: 'boot-1' });

    const active = manager.getActiveSubscriptions();
    assert.equal(active.length, 3);

    // Unsubscribe one
    manager.unsubscribe({ subscriptionId: sub1.subscriptionId });

    const remaining = manager.getActiveSubscriptions();
    assert.equal(remaining.length, 2);
  });

  test('exceeding max subscriptions throws', () => {
    manager = new EventSubscriptionManager(createOptions());

    // Fill up to max
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_RUNTIME; i++) {
      manager.subscribe({ runtimeId: 'runtime-1', bootId: 'boot-1' });
    }

    // One more should throw
    assert.throws(
      () => manager.subscribe({ runtimeId: 'runtime-1', bootId: 'boot-1' }),
      (err: Error) => err.message.includes('Maximum subscriptions'),
    );
  });
});

describe('EventSubscriptionManager: event delivery', () => {
  let manager: EventSubscriptionManager;

  afterEach(() => {
    manager?.destroy();
  });

  test('events are delivered in order', async () => {
    const events = [
      createMockEvent(1, 'player.chat'),
      createMockEvent(2, 'player.join'),
      createMockEvent(3, 'player.chat'),
      createMockEvent(4, 'player.quit'),
    ];

    manager = new EventSubscriptionManager(
      createOptions({
        fetchEvents: async () => events,
      }),
    );

    const { subscriptionId } = manager.subscribe({
      runtimeId: 'runtime-1',
      bootId: 'boot-1',
    });

    // Wait for poll
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = manager.listEvents({ subscriptionId });

    assert.equal(result.events.length, 4);
    // Check ordering
    for (let i = 1; i < result.events.length; i++) {
      assert.ok(
        result.events[i]!.sequence > result.events[i - 1]!.sequence,
        'Events should be ordered by sequence',
      );
    }
  });

  test('cursor advances on each poll', async () => {
    let fetchCallCount = 0;
    const events = [
      createMockEvent(1, 'player.chat'),
      createMockEvent(2, 'player.join'),
      createMockEvent(3, 'player.chat'),
    ];

    manager = new EventSubscriptionManager(
      createOptions({
        fetchEvents: async (_bootId, after, _limit) => {
          fetchCallCount++;
          return events.filter((e) => (e['sequence'] as number) > after);
        },
      }),
    );

    const { subscriptionId } = manager.subscribe({
      runtimeId: 'runtime-1',
      bootId: 'boot-1',
    });

    // Wait for multiple polls
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should have polled multiple times
    assert.ok(fetchCallCount > 1);

    // Events should not be duplicated
    const result = manager.listEvents({ subscriptionId });
    const sequences = result.events.map((e) => e.sequence);
    const uniqueSequences = new Set(sequences);
    assert.equal(sequences.length, uniqueSequences.size, 'No duplicate events');
  });
});

describe('EventSubscriptionManager: destroy', () => {
  test('destroy cleans up all subscriptions', () => {
    const manager = new EventSubscriptionManager(createOptions());

    manager.subscribe({ runtimeId: 'runtime-1', bootId: 'boot-1' });
    manager.subscribe({ runtimeId: 'runtime-2', bootId: 'boot-2' });

    assert.equal(manager.getActiveSubscriptions().length, 2);

    manager.destroy();

    assert.equal(manager.getActiveSubscriptions().length, 0);
  });
});
