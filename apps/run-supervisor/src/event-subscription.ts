/**
 * Event Subscription Manager — V1.1 event-driven architecture.
 *
 * Replaces polling-based event fetching with subscription model:
 *   1. Consumer subscribes to events from a runtime
 *   2. Manager polls Bridge at configurable interval
 *   3. Events are buffered and delivered to consumer
 *   4. Consumer can retrieve events via list/poll
 *
 * Design decisions:
 *   - Per-subscription buffer (ring buffer with max size)
 *   - Automatic expiry (TTL-based)
 *   - Filter support (by type, actor)
 *   - Non-blocking: consumer polls at own pace
 */

import { randomUUID } from 'node:crypto';
import type {
  EventFilter,
  EventRecord,
  EventSubscribeParams,
  EventSubscribeResult,
  EventUnsubscribeResult,
  EventListResult,
} from '@mcpdev/contracts';
import {
  SUBSCRIPTION_TTL_MS,
  MAX_EVENTS_PER_SUBSCRIPTION,
  MAX_SUBSCRIPTIONS_PER_RUNTIME,
} from '@mcpdev/contracts';

// ─── Types ───────────────────────────────────────────────────────────

interface Subscription {
  readonly id: string;
  readonly runtimeId: string;
  readonly bootId: string;
  readonly filter: EventFilter | null;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  maxEvents: number;
  eventsReceived: number;
  lastCursor: number;
  events: EventRecord[];
  pollTimer: ReturnType<typeof setInterval> | null;
}

export interface EventSubscriptionManagerOptions {
  /** Poll interval in milliseconds (default: 200ms) */
  readonly pollIntervalMs?: number;
  /** Default subscription TTL in milliseconds (default: 5 minutes) */
  readonly defaultTtlMs?: number;
  /** Maximum events per subscription (default: 10000) */
  readonly maxEventsPerSubscription?: number;
  /** Event fetcher function */
  readonly fetchEvents: (bootId: string, after: number, limit: number) => Promise<Array<Record<string, unknown>>>;
  /** Logger function */
  readonly log?: (level: string, event: string, data: Record<string, unknown>) => void;
}

// ─── Manager ─────────────────────────────────────────────────────────

export class EventSubscriptionManager {
  readonly #subscriptions = new Map<string, Subscription>();
  readonly #options: Required<EventSubscriptionManagerOptions>;

  constructor(options: EventSubscriptionManagerOptions) {
    this.#options = {
      pollIntervalMs: options.pollIntervalMs ?? 200,
      defaultTtlMs: options.defaultTtlMs ?? SUBSCRIPTION_TTL_MS,
      maxEventsPerSubscription: options.maxEventsPerSubscription ?? MAX_EVENTS_PER_SUBSCRIPTION,
      fetchEvents: options.fetchEvents,
      log: options.log ?? (() => {}),
    };
  }

  // ─── Public API ───────────────────────────────────────────────────

  subscribe(params: EventSubscribeParams): EventSubscribeResult {
    const { runtimeId, bootId, filter, maxEvents } = params;

    // Check subscription limit
    const existingCount = this.#countSubscriptionsForRuntime(runtimeId);
    if (existingCount >= MAX_SUBSCRIPTIONS_PER_RUNTIME) {
      throw Object.assign(
        new Error(`Maximum subscriptions (${MAX_SUBSCRIPTIONS_PER_RUNTIME}) exceeded for runtime ${runtimeId}`),
        { code: 'EVENT_MAX_SUBSCRIPTIONS_EXCEEDED' },
      );
    }

    const id = randomUUID();
    const now = Date.now();
    const ttl = this.#options.defaultTtlMs;

    const subscription: Subscription = {
      id,
      runtimeId,
      bootId,
      filter: filter ?? null,
      createdAtMs: now,
      expiresAtMs: now + ttl,
      maxEvents: maxEvents ?? this.#options.maxEventsPerSubscription,
      eventsReceived: 0,
      lastCursor: 0,
      events: [],
      pollTimer: null,
    };

    this.#subscriptions.set(id, subscription);
    this.#startPolling(subscription);

    this.#log('INFO', 'event.subscription.created', {
      subscriptionId: id,
      runtimeId,
      bootId,
      filter: filter ?? 'none',
      ttlMs: ttl,
    });

    return {
      subscriptionId: id,
      status: 'active',
      eventsReceived: 0,
    };
  }

  unsubscribe(params: { subscriptionId: string }): EventUnsubscribeResult {
    const sub = this.#subscriptions.get(params.subscriptionId);
    if (!sub) {
      throw Object.assign(
        new Error(`Subscription not found: ${params.subscriptionId}`),
        { code: 'EVENT_SUBSCRIPTION_NOT_FOUND' },
      );
    }

    this.#stopPolling(sub);
    this.#subscriptions.delete(sub.id);

    this.#log('INFO', 'event.subscription.removed', {
      subscriptionId: sub.id,
      eventsReceived: sub.eventsReceived,
    });

    return {
      subscriptionId: sub.id,
      status: 'unsubscribed',
      eventsReceived: sub.eventsReceived,
    };
  }

  listEvents(params: { subscriptionId: string; after?: number; limit?: number }): EventListResult {
    const sub = this.#subscriptions.get(params.subscriptionId);
    if (!sub) {
      throw Object.assign(
        new Error(`Subscription not found: ${params.subscriptionId}`),
        { code: 'EVENT_SUBSCRIPTION_NOT_FOUND' },
      );
    }

    const after = params.after ?? 0;
    const limit = Math.min(params.limit ?? 100, 1000);

    const filtered = sub.events.filter((e) => e.sequence > after);
    const page = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const nextCursor = hasMore ? page[page.length - 1]?.sequence ?? null : null;

    return {
      subscriptionId: sub.id,
      events: page,
      hasMore,
      nextCursor,
    };
  }

  getActiveSubscriptions(): Array<{
    readonly subscriptionId: string;
    readonly runtimeId: string;
    readonly bootId: string;
    readonly eventsReceived: number;
    readonly expiresAtMs: number;
  }> {
    const now = Date.now();
    const active: Array<{
      subscriptionId: string;
      runtimeId: string;
      bootId: string;
      eventsReceived: number;
      expiresAtMs: number;
    }> = [];

    for (const sub of this.#subscriptions.values()) {
      if (sub.expiresAtMs > now) {
        active.push({
          subscriptionId: sub.id,
          runtimeId: sub.runtimeId,
          bootId: sub.bootId,
          eventsReceived: sub.eventsReceived,
          expiresAtMs: sub.expiresAtMs,
        });
      }
    }

    return active;
  }

  destroy(): void {
    for (const sub of this.#subscriptions.values()) {
      this.#stopPolling(sub);
    }
    this.#subscriptions.clear();
  }

  // ─── Internal ─────────────────────────────────────────────────────

  #countSubscriptionsForRuntime(runtimeId: string): number {
    let count = 0;
    for (const sub of this.#subscriptions.values()) {
      if (sub.runtimeId === runtimeId && sub.expiresAtMs > Date.now()) {
        count++;
      }
    }
    return count;
  }

  #startPolling(sub: Subscription): void {
    sub.pollTimer = setInterval(async () => {
      await this.#pollSubscription(sub);
    }, this.#options.pollIntervalMs);
  }

  #stopPolling(sub: Subscription): void {
    if (sub.pollTimer !== null) {
      clearInterval(sub.pollTimer);
      sub.pollTimer = null;
    }
  }

  async #pollSubscription(sub: Subscription): Promise<void> {
    // Check expiry
    if (Date.now() > sub.expiresAtMs) {
      this.#stopPolling(sub);
      this.#log('INFO', 'event.subscription.expired', { subscriptionId: sub.id });
      return;
    }

    try {
      const rawEvents = await this.#options.fetchEvents(
        sub.bootId,
        sub.lastCursor,
        100,
      );

      for (const raw of rawEvents) {
        const event = this.#parseEvent(raw);
        if (!event) continue;

        // Apply filter
        if (sub.filter && !this.#matchesFilter(event, sub.filter)) {
          continue;
        }

        // Buffer event
        if (sub.events.length < sub.maxEvents) {
          sub.events.push(event);
        }

        sub.lastCursor = event.sequence;
        sub.eventsReceived++;
      }
    } catch (err) {
      this.#log('WARN', 'event.subscription.poll_error', {
        subscriptionId: sub.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  #parseEvent(raw: Record<string, unknown>): EventRecord | null {
    try {
      return {
        sequence: raw['sequence'] as number,
        eventId: raw['event_id'] as string,
        type: raw['type'] as string,
        runId: raw['run_id'] as string | null,
        serverInstanceId: raw['server_instance_id'] as string,
        bridgeBootId: raw['bridge_boot_id'] as string,
        correlationId: raw['correlation_id'] as string | null,
        causationId: raw['causation_id'] as string | null,
        serverTick: raw['server_tick'] as number,
        occurredAt: raw['occurred_at'] as string,
        actor: raw['actor'] as string | null,
        data: (raw['data'] as Record<string, unknown>) ?? {},
        source: raw['source'] as string,
      };
    } catch {
      return null;
    }
  }

  #matchesFilter(event: EventRecord, filter: EventFilter): boolean {
    // Type filter
    if (filter.types && filter.types.length > 0) {
      if (!filter.types.includes(event.type)) return false;
    }

    // Exclude types
    if (filter.excludeTypes && filter.excludeTypes.length > 0) {
      if (filter.excludeTypes.includes(event.type)) return false;
    }

    // Actor filter
    if (filter.actor) {
      if (event.actor !== filter.actor) return false;
    }

    return true;
  }

  #log(level: string, event: string, data: Record<string, unknown>): void {
    this.#options.log(level, event, data);
  }
}
