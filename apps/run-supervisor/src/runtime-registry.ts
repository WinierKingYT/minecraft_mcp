/**
 * Runtime Registry — Supervisor'ın sahip olduğu runtime'ların kaydı.
 *
 * ADR-0003: sahiplik Supervisor'da yaşar. Registry, bir runtime'ın hangi
 * durumda olduğunu ve process parmak izini tutar; öldürme kararı yalnızca
 * `verifyOwnership` üzerinden verilir.
 *
 * M0'da bellek içidir. Kalıcı kayıt (SQLite) ve startup recovery M1'e aittir;
 * o zamana kadar Supervisor yeniden başlatıldığında kurtaracak kayıt yoktur ve
 * bu durum `supervisor.health` yanıtında gizlenmez.
 */

import type { RuntimeIpcState, RuntimeSummary } from '@mcpdev/contracts';
import type { RuntimeImage } from './runtime-image.js';
import type { RunningRuntime } from './runtime-launch.js';
import type { OwnershipRecord } from './ownership.js';

export interface RuntimeEntry {
  readonly image: RuntimeImage;
  state: RuntimeIpcState;
  running: RunningRuntime | null;
  ownership: OwnershipRecord | null;
  readyGateMs: number | null;
  readonly createdAt: string;
  /** Son durum geçişinin zaman damgası (ms) — GC retention'ı buna bakar. */
  stateChangedAt: number;
  /** Son launch denemesinin hata mesajı; yoksa null (plugin_diagnose okur). */
  launchError: string | null;
}

export class RuntimeNotFoundError extends Error {
  readonly code = 'RUNTIME_NOT_FOUND' as const;

  constructor(runtimeImageId: string) {
    super(`Runtime kaydı bulunamadı: ${runtimeImageId}`);
    this.name = 'RuntimeNotFoundError';
  }
}

export class RuntimeStateError extends Error {
  readonly code = 'RUNTIME_INVALID_STATE' as const;

  constructor(
    readonly runtimeImageId: string,
    readonly actual: RuntimeIpcState,
    readonly expected: readonly RuntimeIpcState[],
  ) {
    super(
      `Runtime ${runtimeImageId} durumu "${actual}"; beklenen: ${expected.join(', ')}. ` +
        'runtime_get ile mevcut durumu okuyun.',
    );
    this.name = 'RuntimeStateError';
  }
}

export class RuntimeRegistry {
  readonly #entries = new Map<string, RuntimeEntry>();
  readonly #maxConcurrent: number;

  constructor(maxConcurrent = 1) {
    this.#maxConcurrent = maxConcurrent;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Quota'ya sayılan canlı durumlar (release/GC durumları hariç). */
  static readonly ACTIVE_STATES: readonly RuntimeIpcState[] = [
    'CREATED',
    'STARTING',
    'READY',
    'STOPPING',
    'STOPPED',
    'CRASHED',
  ];

  /** Serbest bırakılmış (quota dışı) runtime sayısı. */
  get activeCount(): number {
    let count = 0;
    for (const entry of this.#entries.values()) {
      if (RuntimeRegistry.ACTIVE_STATES.includes(entry.state)) count++;
    }
    return count;
  }

  assertQuota(): void {
    if (this.activeCount >= this.#maxConcurrent) {
      const error = new Error(
        `Eşzamanlı runtime limiti aşıldı (${this.#maxConcurrent}). ` +
          'Mevcut runtime\'ları plugin_stop ve runtime_release ile serbest bırakın.',
      );
      Object.defineProperty(error, 'code', { value: 'RUNTIME_QUOTA_EXCEEDED' });
      throw error;
    }
  }

  register(image: RuntimeImage): RuntimeEntry {
    const entry: RuntimeEntry = {
      image,
      state: 'CREATED',
      running: null,
      ownership: null,
      readyGateMs: null,
      createdAt: image.createdAt,
      stateChangedAt: Date.now(),
      launchError: null,
    };
    this.#entries.set(image.runtimeImageId, entry);
    return entry;
  }

  /**
   * Durum geçişini kaydeder — `stateChangedAt` zaman damgası GC retention
   * hesabının temelidir. Doğrudan `entry.state = ...` ataması yerine bu
   * metot kullanılır.
   */
  updateState(entry: RuntimeEntry, state: RuntimeIpcState): void {
    entry.state = state;
    entry.stateChangedAt = Date.now();
  }

  /**
   * Kaydı registry'den kaldırır (yalnızca GC — DELETED sonrası).
   * RuntimeNotFoundError yaymaz; yoksa sessizce döner.
   */
  remove(runtimeImageId: string): boolean {
    return this.#entries.delete(runtimeImageId);
  }

  get(runtimeImageId: string): RuntimeEntry {
    const entry = this.#entries.get(runtimeImageId);
    if (!entry) {
      throw new RuntimeNotFoundError(runtimeImageId);
    }
    return entry;
  }

  requireState(runtimeImageId: string, expected: readonly RuntimeIpcState[]): RuntimeEntry {
    const entry = this.get(runtimeImageId);
    if (!expected.includes(entry.state)) {
      throw new RuntimeStateError(runtimeImageId, entry.state, expected);
    }
    return entry;
  }

  list(): RuntimeEntry[] {
    return [...this.#entries.values()];
  }

  summarize(entry: RuntimeEntry): RuntimeSummary {
    return {
      runtimeImageId: entry.image.runtimeImageId,
      serverInstanceId: entry.image.serverInstanceId,
      state: entry.state,
      bridgeBootId: entry.running?.handshake.bridge_boot_id ?? null,
      bridgePort: entry.running?.handshake.port ?? null,
      paperJarSha256: entry.image.paperJarSha256,
      bridgeJarSha256: entry.image.bridgeJarSha256,
      createdAt: entry.createdAt,
      readyGateMs: entry.readyGateMs,
    };
  }
}
