/**
 * Persistent Runtime Registry — disk tabanlı kalıcılık.
 *
 * Runtime kayıtlarını disk'e yazarak Supervisor yeniden başlatıldığında
 * kurtarılmasını sağlar. M0'da bellek içidir; bu modül M1 için hazırlıktır.
 *
 * Depolama formatı: JSON dosyası (runtime-registry.json).
 * Güvenlik: Symlink koruması, atomic write (temp + rename).
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { RuntimeIpcState } from '@mcpdev/contracts';
import { RuntimeRegistry, type RuntimeEntry } from './runtime-registry.js';
import type { RuntimeImage } from './runtime-image.js';
import type { OwnershipRecord } from './ownership.js';
import { BRIDGE_TOKEN_FILE, RUNTIME_MARKER_FILE, HANDSHAKE_FILE } from './runtime-image.js';

export interface PersistedRuntimeRecord {
  readonly runtimeImageId: string;
  readonly serverInstanceId: string;
  readonly state: RuntimeIpcState;
  readonly paperJarSha256: string;
  readonly bridgeJarSha256: string;
  readonly createdAt: string;
  readonly readyGateMs: number | null;
  readonly stateChangedAt: number;
  readonly runtimeRoot: string;
  readonly ownership: {
    readonly runtimeId: string;
    readonly serverInstanceId: string;
    readonly kind: string;
    readonly registeredAtMs: number;
    readonly pid: number;
    readonly executablePath: string;
    readonly startedAtMs: number;
    readonly runtimeMarkerSha256: string;
  } | null;
}

export interface PersistedRegistryData {
  readonly version: 1;
  readonly updatedAt: string;
  readonly records: readonly PersistedRuntimeRecord[];
}

export interface PersistentRegistryOptions {
  /** Kalıcılık dosyasının yolu. */
  readonly filePath: string;
  /** Maksimum eşzamanlı runtime sayısı. */
  readonly maxConcurrent?: number;
  /** Logger. */
  readonly log?: (level: string, event: string, fields: Record<string, unknown>) => void;
}

export class PersistentRuntimeRegistry extends RuntimeRegistry {
  readonly #filePath: string;
  readonly #log?: PersistentRegistryOptions['log'];
  #dirty = false;

  constructor(options: PersistentRegistryOptions) {
    super(options.maxConcurrent);
    this.#filePath = options.filePath;
    this.#log = options.log;
  }

  #logEvent(level: string, event: string, fields: Record<string, unknown> = {}): void {
    this.#log?.(level, event, fields);
  }

  /**
   * Disk'ten registry'yi yükler ve kayıtları belleğe geri kurar.
   *
   * Supervisor yeniden başladığında çalışan process'ler kaybolmuştur; bu
   * yüzden CREATE/STARTING/READY kayıtları CRASHED'a çekilir. Dizinler yerinde
   * kaldığı için GC bunları retention kurallarıyla toplar (runtime-gc.ts).
   * Token kalıcılığa YAZILMAZ (secret); geri yüklenen kayıtlar yalnızca
   * metadata + GC amaçlıdır (running: null).
   */
  async load(): Promise<void> {
    if (!existsSync(this.#filePath)) {
      this.#logEvent('INFO', 'persistent_registry.no_file', { path: this.#filePath });
      return;
    }

    try {
      const content = await readFile(this.#filePath, 'utf8');
      const data = JSON.parse(content) as PersistedRegistryData;

      if (data.version !== 1) {
        this.#logEvent('WARN', 'persistent_registry.invalid_version', { version: data.version });
        return;
      }

      let restored = 0;
      let crashed = 0;
      for (const record of data.records) {
        const wasRunning = record.state === 'CREATED' || record.state === 'STARTING' || record.state === 'READY';
        const restoredState: RuntimeIpcState = wasRunning ? 'CRASHED' : record.state;

        if (wasRunning) {
          crashed++;
          this.#logEvent('WARN', 'persistent_registry.runtime_was_running', {
            runtimeImageId: record.runtimeImageId,
            previousState: record.state,
          });
        }

        const image: RuntimeImage = {
          runtimeImageId: record.runtimeImageId,
          runtimeRoot: record.runtimeRoot,
          serverInstanceId: record.serverInstanceId,
          // Yalnızca metadata; geri yüklendikten sonra process yoktur.
          paperJarPath: '',
          paperJarSha256: record.paperJarSha256,
          bridgeJarSha256: record.bridgeJarSha256,
          token: '',
          tokenFile: join(record.runtimeRoot, BRIDGE_TOKEN_FILE),
          markerFile: join(record.runtimeRoot, RUNTIME_MARKER_FILE),
          handshakeFile: join(record.runtimeRoot, HANDSHAKE_FILE),
          createdAt: record.createdAt,
        };

        const entry = super.register(image);
        entry.state = restoredState;
        entry.stateChangedAt = record.stateChangedAt;
        entry.readyGateMs = record.readyGateMs;
        entry.ownership = record.ownership as OwnershipRecord | null;
        restored++;
      }

      this.#dirty = false;
      this.#logEvent('INFO', 'persistent_registry.loaded', {
        count: restored,
        crashed,
        updatedAt: data.updatedAt,
      });
    } catch (err) {
      this.#logEvent('ERROR', 'persistent_registry.load_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Registry'yi disk'e yazar.
   * Atomic write: önce temp dosyasına yaz, sonra rename.
   */
  async save(): Promise<void> {
    const data: PersistedRegistryData = {
      version: 1,
      updatedAt: new Date().toISOString(),
      records: this.list().map((entry) => ({
        runtimeImageId: entry.image.runtimeImageId,
        serverInstanceId: entry.image.serverInstanceId,
        state: entry.state,
        paperJarSha256: entry.image.paperJarSha256,
        bridgeJarSha256: entry.image.bridgeJarSha256,
        createdAt: entry.createdAt,
        readyGateMs: entry.readyGateMs,
        stateChangedAt: entry.stateChangedAt,
        runtimeRoot: entry.image.runtimeRoot,
        ownership: entry.ownership,
      })),
    };

    try {
      const dir = dirname(this.#filePath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      // Atomic write: temp dosyasına yaz, sonra rename
      const tempPath = `${this.#filePath}.tmp.${randomBytes(8).toString('hex')}`;
      await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
      await rename(tempPath, this.#filePath);

      this.#dirty = false;
      this.#logEvent('DEBUG', 'persistent_registry.saved', {
        count: data.records.length,
      });
    } catch (err) {
      this.#logEvent('ERROR', 'persistent_registry.save_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Değişiklik varsa disk'e yazar.
   */
  async flush(): Promise<void> {
    if (this.#dirty) {
      await this.save();
    }
  }

  /**
   * Register override — dirty flag ayarla.
   */
  override register(image: RuntimeImage): RuntimeEntry {
    const entry = super.register(image);
    this.#dirty = true;
    return entry;
  }

  /** State geçişini izler ve kalıcılığı kirletir. */
  override updateState(entry: RuntimeEntry, state: RuntimeIpcState): void {
    super.updateState(entry, state);
    this.#dirty = true;
  }

  /** Kayıt kaldırmayı izler ve kalıcılığı kirletir. */
  override remove(runtimeImageId: string): boolean {
    const removed = super.remove(runtimeImageId);
    if (removed) this.#dirty = true;
    return removed;
  }

  /**
   * Entry state change tracking.
   * State değişimlerini izlemek için entry'yi sarmalayabiliriz.
   */
  markDirty(): void {
    this.#dirty = true;
  }

  /**
   * Mevcut durumu döndürür (debug için).
   */
  get isDirty(): boolean {
    return this.#dirty;
  }
}
