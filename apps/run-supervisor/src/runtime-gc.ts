/**
 * Runtime Garbage Collector — RETENTION → DELETE_VALIDATION → DELETING → DELETED.
 *
 * State machine (docs/architecture/state-machines.md):
 * - RELEASED kayıtları ilk taramada RETENTION'a geçer.
 * - Retention süresi dolan kayıtlar DELETE_VALIDATION'a geçer: dizin hâlâ
 *   yerinde mi, runtime kökü içinde mi, process çalışıyor mu — hepsi temizse
 *   DELETING → dizin silinir → DELETED → registry'den kaldırılır.
 * - Doğrulama başarısızsa kayıt silinmez (sonraki taramada yeniden denenir);
 *   dizin zaten yoksa kayıt olduğu gibi atılır.
 *
 * Agent DELETING başlatamaz (state-machines.md): silme yalnızca bu sınıfın
 * taramalarından gelir. Marker dosyası olmayan dizinler silinmez (FS-05).
 */

import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, isAbsolute, resolve } from 'node:path';
import type { RuntimeRegistry, RuntimeEntry } from './runtime-registry.js';
import { RUNTIME_MARKER_FILE } from './runtime-image.js';

export interface GarbageCollectorOptions {
  readonly registry: RuntimeRegistry;
  /** Runtime kök dizinlerinin barındığı host dizini (containment doğrulaması). */
  readonly runtimeRootDir: string;
  /** RETENTION sonrası bekleme süresi (ms). Varsayılan: 24 saat. */
  readonly retentionMs?: number;
  /** Tarama aralığı (ms). Varsayılan: 5 dakika. */
  readonly sweepIntervalMs?: number;
  readonly log?: (level: string, event: string, fields: Record<string, unknown>) => void;
  /** Her tarama sonrası çağrılır (kalıcılık flush'ı için). */
  readonly onChange?: () => void | Promise<void>;
}

export interface GarbageCollectorSweepResult {
  /** RELEASED → RETENTION geçişi yapılan kayıt sayısı. */
  released: number;
  /** Silinen (DELETED) kayıt sayısı. */
  deleted: number;
  /** Silinemeyen / doğrulamayı geçemeyen kayıt sayısı. */
  skipped: number;
}

export class RuntimeGarbageCollector {
  readonly #options: GarbageCollectorOptions;
  #timer: NodeJS.Timeout | null = null;
  #running = false;

  constructor(options: GarbageCollectorOptions) {
    this.#options = options;
  }

  #log(level: string, event: string, fields: Record<string, unknown> = {}): void {
    this.#options.log?.(level, event, fields);
  }

  /** Periyodik taramayı başlatır. */
  start(): void {
    if (this.#timer) return;
    const interval = this.#options.sweepIntervalMs ?? 300_000;
    this.#timer = setInterval(() => {
      void this.sweep().catch(() => undefined);
    }, interval);
    this.#timer.unref();
  }

  /** Periyodik taramayı durdurur. */
  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** Tek tarama koşusu — testler ve start() için. */
  async sweep(): Promise<GarbageCollectorSweepResult> {
    if (this.#running) return { released: 0, deleted: 0, skipped: 0 };
    this.#running = true;
    const result: GarbageCollectorSweepResult = { released: 0, deleted: 0, skipped: 0 };

    try {
      const retentionMs = this.#options.retentionMs ?? 86_400_000;
      const now = Date.now();
      const entries = this.#options.registry.list();

      for (const entry of entries) {
        if (entry.state === 'RELEASED') {
          // RELEASED → RETENTION (geçiş anı kaydedilir; retention buradan işler).
          this.#options.registry.updateState(entry, 'RETENTION');
          result.released++;
        } else if (entry.state === 'RETENTION' && now - entry.stateChangedAt >= retentionMs) {
          await this.#deleteIfValid(entry, result);
        }
      }

      this.#log('INFO', 'garbage_collector.swept', {
        released: result.released,
        deleted: result.deleted,
        skipped: result.skipped,
      });
    } finally {
      this.#running = false;
    }

    await this.#options.onChange?.();
    return result;
  }

  async #deleteIfValid(entry: RuntimeEntry, result: GarbageCollectorSweepResult): Promise<void> {
    const root = resolve(entry.image.runtimeRoot);
    const parent = resolve(this.#options.runtimeRootDir);
    const rel = relative(parent, root);
    const inside = !(rel.startsWith('..') || isAbsolute(rel));
    const marker = join(root, RUNTIME_MARKER_FILE);

    // DELETE_VALIDATION: dizin yerinde + runtime kökü içinde + marker mevcut
    // + çalışan process yok (geri yüklü kayıtlarda running her zaman null'dır).
    if (entry.running) {
      result.skipped++;
      return;
    }
    if (!existsSync(root)) {
      // Dizin zaten yok: kayıt atılır, silme gerekmez.
      this.#options.registry.remove(entry.image.runtimeImageId);
      result.deleted++;
      return;
    }
    if (!inside) {
      // Kök dışı bir yol asla silinmez — yapılandırma hatası olarak kabul.
      this.#log('WARN', 'garbage_collector.path_outside_root', { runtimeImageId: entry.image.runtimeImageId });
      result.skipped++;
      return;
    }
    if (!existsSync(marker)) {
      this.#log('WARN', 'garbage_collector.marker_missing', { runtimeImageId: entry.image.runtimeImageId });
      result.skipped++;
      return;
    }

    this.#options.registry.updateState(entry, 'DELETE_VALIDATION');
    this.#options.registry.updateState(entry, 'DELETING');
    try {
      await rm(root, { recursive: true, force: true });
    } catch (err) {
      this.#log('ERROR', 'garbage_collector.delete_failed', {
        runtimeImageId: entry.image.runtimeImageId,
        error: err instanceof Error ? err.message : String(err),
      });
      result.skipped++;
      return;
    }

    this.#options.registry.updateState(entry, 'DELETED');
    this.#options.registry.remove(entry.image.runtimeImageId);
    result.deleted++;
    this.#log('INFO', 'garbage_collector.deleted', {
      runtimeImageId: entry.image.runtimeImageId,
      runtimeRoot: root,
    });
  }
}
