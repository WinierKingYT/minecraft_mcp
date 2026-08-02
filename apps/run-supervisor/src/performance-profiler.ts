import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export interface ProfileOptions {
  readonly maxSamples?: number;
  readonly enableAutoReport?: boolean;
  readonly reportIntervalMs?: number;
}

export interface ProfileSample {
  readonly sampleId: string;
  readonly operation: string;
  readonly category: 'build' | 'scenario' | 'runtime' | 'bridge' | 'custom';
  readonly startMs: number;
  endMs: number | null;
  durationMs: number | null;
  success: boolean | null;
  metadata: Record<string, unknown>;
  tags: string[];
}

export interface ProfileStats {
  readonly operation: string;
  readonly category: string;
  readonly count: number;
  readonly totalMs: number;
  readonly avgMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly successRate: number;
}

export interface ProfileReport {
  readonly generatedAt: string;
  readonly totalSamples: number;
  readonly stats: ProfileStats[];
  readonly operations: string[];
  readonly categories: string[];
}

export class PerformanceProfiler extends EventEmitter {
  #samples: ProfileSample[] = [];
  #maxSamples: number;
  #autoReportInterval: NodeJS.Timeout | null = null;

  constructor(options: ProfileOptions = {}) {
    super();
    this.#maxSamples = options.maxSamples ?? 10_000;

    if (options.enableAutoReport && options.reportIntervalMs) {
      this.#autoReportInterval = setInterval(() => {
        this.emit('report', this.generateReport());
      }, options.reportIntervalMs);
    }
  }

  start(operation: string, category: ProfileSample['category'] = 'custom', metadata: Record<string, unknown> = {}, tags: string[] = []): ProfileSample {
    const sample: ProfileSample = {
      sampleId: `prof_${randomUUID().slice(0, 8)}`,
      operation,
      category,
      startMs: Date.now(),
      endMs: null,
      durationMs: null,
      success: null,
      metadata,
      tags,
    };

    this.#samples.push(sample);

    if (this.#samples.length > this.#maxSamples) {
      this.#samples = this.#samples.slice(-this.#maxSamples);
    }

    return sample;
  }

  end(sampleId: string, success: boolean = true, metadata: Record<string, unknown> = {}): void {
    const sample = this.#samples.find((s) => s.sampleId === sampleId);
    if (!sample) {
      throw new Error(`Sample not found: ${sampleId}`);
    }

    sample.endMs = Date.now();
    sample.durationMs = sample.endMs - sample.startMs;
    sample.success = success;
    Object.assign(sample.metadata, metadata);

    this.emit('sample', sample);
  }

  measure<T>(operation: string, category: ProfileSample['category'] = 'custom', fn: () => T | Promise<T>, metadata: Record<string, unknown> = {}): T | Promise<T> {
    const sample = this.start(operation, category, metadata);

    try {
      const result = fn();
      if (result instanceof Promise) {
        return result
          .then((value) => {
            this.end(sample.sampleId, true, { result: 'success' });
            return value;
          })
          .catch((error) => {
            this.end(sample.sampleId, false, { error: String(error) });
            throw error;
          });
      }
      this.end(sample.sampleId, true, { result: 'success' });
      return result;
    } catch (error) {
      this.end(sample.sampleId, false, { error: String(error) });
      throw error;
    }
  }

  getStats(operation?: string, category?: string): ProfileStats[] {
    let filtered = this.#samples.filter((s) => s.endMs !== null);

    if (operation) {
      filtered = filtered.filter((s) => s.operation === operation);
    }
    if (category) {
      filtered = filtered.filter((s) => s.category === category);
    }

    const grouped = new Map<string, ProfileSample[]>();
    for (const sample of filtered) {
      const key = `${sample.category}:${sample.operation}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(sample);
    }

    const stats: ProfileStats[] = [];
    for (const [key, samples] of grouped) {
      const [category, operation] = key.split(':');
      const durations = samples.map((s) => s.durationMs!).sort((a, b) => a - b);
      const successes = samples.filter((s) => s.success).length;

      stats.push({
        operation: operation ?? 'unknown',
        category: category ?? 'unknown',
        count: samples.length,
        totalMs: durations.reduce((sum, d) => sum + d, 0),
        avgMs: durations.reduce((sum, d) => sum + d, 0) / durations.length,
        minMs: durations[0] ?? 0,
        maxMs: durations[durations.length - 1] ?? 0,
        p50Ms: durations[Math.floor(durations.length * 0.5)] ?? 0,
        p95Ms: durations[Math.floor(durations.length * 0.95)] ?? 0,
        p99Ms: durations[Math.floor(durations.length * 0.99)] ?? 0,
        successRate: successes / samples.length,
      });
    }

    return stats.sort((a, b) => b.count - a.count);
  }

  generateReport(): ProfileReport {
    const stats = this.getStats();
    const operations = [...new Set(this.#samples.map((s) => s.operation))];
    const categories = [...new Set(this.#samples.map((s) => s.category))];

    return {
      generatedAt: new Date().toISOString(),
      totalSamples: this.#samples.length,
      stats,
      operations,
      categories,
    };
  }

  clear(): void {
    this.#samples = [];
  }

  getSamples(limit?: number): ProfileSample[] {
    if (limit) {
      return this.#samples.slice(-limit);
    }
    return [...this.#samples];
  }

  destroy(): void {
    if (this.#autoReportInterval) {
      clearInterval(this.#autoReportInterval);
      this.#autoReportInterval = null;
    }
    this.removeAllListeners();
    this.#samples = [];
  }
}
