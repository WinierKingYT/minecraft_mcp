import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export interface RuntimePoolOptions {
  readonly maxPoolSize?: number;
  readonly maxIdleMs?: number;
  readonly maxReuseCount?: number;
}

export interface PooledRuntime {
  readonly poolId: string;
  readonly runtimeImageId: string;
  runtimeId: string;
  bootId: string;
  acquiredAt: number;
  reuseCount: number;
  state: 'IDLE' | 'ACQUIRED' | 'EVICTED' | 'EXPIRED';
  lastActivityAt: number;
  createdAt: number;
}

export interface PoolStatus {
  readonly total: number;
  readonly idle: number;
  readonly acquired: number;
  readonly evicted: number;
  readonly expired: number;
  readonly maxPoolSize: number;
  readonly maxIdleMs: number;
  readonly maxReuseCount: number;
}

export class RuntimePool extends EventEmitter {
  #pool = new Map<string, PooledRuntime>();
  #maxPoolSize: number;
  #maxIdleMs: number;
  #maxReuseCount: number;
  #idleCheckInterval: NodeJS.Timeout | null = null;

  constructor(options: RuntimePoolOptions = {}) {
    super();
    this.#maxPoolSize = options.maxPoolSize ?? 5;
    this.#maxIdleMs = options.maxIdleMs ?? 300_000; // 5 minutes
    this.#maxReuseCount = options.maxReuseCount ?? 10;

    this.#startIdleCheck();
  }

  #startIdleCheck(): void {
    this.#idleCheckInterval = setInterval(() => {
      const now = Date.now();
      for (const [poolId, runtime] of this.#pool) {
        if (runtime.state !== 'IDLE') continue;
        if (now - runtime.lastActivityAt > this.#maxIdleMs) {
          runtime.state = 'EXPIRED';
          this.#pool.delete(poolId);
          this.emit('expired', { poolId, runtimeImageId: runtime.runtimeImageId });
        }
      }
    }, 30_000); // Check every 30 seconds
  }

  acquire(runtimeImageId: string, runtimeId: string, bootId: string): PooledRuntime {
    if (this.#pool.size >= this.#maxPoolSize) {
      throw new Error(`Pool is full: ${this.#pool.size}/${this.#maxPoolSize}`);
    }

    const existing = Array.from(this.#pool.values()).find(
      (r) => r.runtimeImageId === runtimeImageId && r.state === 'IDLE',
    );

    if (existing) {
      existing.state = 'ACQUIRED';
      existing.acquiredAt = Date.now();
      existing.lastActivityAt = Date.now();
      existing.runtimeId = runtimeId;
      existing.bootId = bootId;
      return existing;
    }

    const poolId = `pool_${randomUUID().slice(0, 8)}`;
    const pooled: PooledRuntime = {
      poolId,
      runtimeImageId,
      runtimeId,
      bootId,
      acquiredAt: Date.now(),
      reuseCount: 0,
      state: 'ACQUIRED',
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
    };

    this.#pool.set(poolId, pooled);
    return pooled;
  }

  release(poolId: string): void {
    const runtime = this.#pool.get(poolId);
    if (!runtime) {
      throw new Error(`Pool entry not found: ${poolId}`);
    }

    if (runtime.state !== 'ACQUIRED') {
      throw new Error(`Cannot release pool entry in state: ${runtime.state}`);
    }

    const newReuseCount = runtime.reuseCount + 1;
    if (newReuseCount >= this.#maxReuseCount) {
      runtime.state = 'EVICTED';
      this.#pool.delete(poolId);
      this.emit('evicted', { poolId, runtimeImageId: runtime.runtimeImageId, reuseCount: newReuseCount });
      return;
    }

    runtime.reuseCount = newReuseCount;
    runtime.state = 'IDLE';
    runtime.lastActivityAt = Date.now();
    this.emit('released', { poolId, runtimeImageId: runtime.runtimeImageId });
  }

  evict(poolId: string): void {
    const runtime = this.#pool.get(poolId);
    if (!runtime) {
      throw new Error(`Pool entry not found: ${poolId}`);
    }

    runtime.state = 'EVICTED';
    this.#pool.delete(poolId);
    this.emit('evicted', { poolId, runtimeImageId: runtime.runtimeImageId, reuseCount: runtime.reuseCount });
  }

  getPoolEntry(poolId: string): PooledRuntime | undefined {
    return this.#pool.get(poolId);
  }

  listByRuntimeImage(runtimeImageId: string): PooledRuntime[] {
    return Array.from(this.#pool.values()).filter((r) => r.runtimeImageId === runtimeImageId);
  }

  listAll(): PooledRuntime[] {
    return Array.from(this.#pool.values());
  }

  getStatus(): PoolStatus {
    let idle = 0;
    let acquired = 0;
    let evicted = 0;
    let expired = 0;

    for (const runtime of this.#pool.values()) {
      switch (runtime.state) {
        case 'IDLE':
          idle++;
          break;
        case 'ACQUIRED':
          acquired++;
          break;
        case 'EVICTED':
          evicted++;
          break;
        case 'EXPIRED':
          expired++;
          break;
      }
    }

    return {
      total: this.#pool.size,
      idle,
      acquired,
      evicted,
      expired,
      maxPoolSize: this.#maxPoolSize,
      maxIdleMs: this.#maxIdleMs,
      maxReuseCount: this.#maxReuseCount,
    };
  }

  destroy(): void {
    if (this.#idleCheckInterval) {
      clearInterval(this.#idleCheckInterval);
      this.#idleCheckInterval = null;
    }
    this.#pool.clear();
    this.removeAllListeners();
  }
}
