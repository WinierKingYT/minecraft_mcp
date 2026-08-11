/**
 * Persistent Project Registry — proje kayıtlarının disk tabanlı kalıcılığı.
 *
 * Supervisor yeniden başlatıldığında proje kayıtları (id → canonical root,
 * trust seviyesi, backend izinleri) kaybolmamalıdır; aksi hâlde kayıtlı
 * projeler `PROJECT_NOT_REGISTERED` ile erişilemez olur. P0-4k: depo +
 * `project_register` başarı yolu.
 *
 * Güvenlik:
 *  - Trust kaydı proje klasörünün İÇİNDE tutulmaz; varsayılan konum
 *    repoRoot/.mcpdev-data/project-registry.json'dur (gitignore'lu) —
 *    projeye yazma yetkisi olan kod kendi trust kaydını düzenleyemez.
 *  - Atomic write (temp + rename): bozuk/yarım yazım dosyayı bozamaz.
 *  - Load, her kaydı `register()`'dan geçirir; canonical kök ve symlink
 *    doğrulaması geri yüklemede de çalışır (bkz. project-registry.ts).
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { TrustLevel, ExecutionBackendKind } from '@mcpdev/contracts';
import { ProjectRegistry, ProjectError, type RegisteredProject } from './project-registry.js';

export interface PersistedProjectRecord {
  readonly id: string;
  readonly canonicalRoot: string;
  readonly trustLevel: TrustLevel;
  readonly allowedBackends: readonly ExecutionBackendKind[];
  readonly defaultBackend: ExecutionBackendKind;
  readonly registeredAt: string;
}

export interface PersistedProjectRegistryData {
  readonly version: 1;
  readonly updatedAt: string;
  readonly projects: readonly PersistedProjectRecord[];
}

export interface PersistentProjectRegistryOptions {
  /** Kalıcılık dosyasının yolu. */
  readonly filePath: string;
  /** Logger. */
  readonly log?: (level: string, event: string, fields: Record<string, unknown>) => void;
}

export class PersistentProjectRegistry extends ProjectRegistry {
  readonly #filePath: string;
  readonly #log?: PersistentProjectRegistryOptions['log'];
  #dirty = false;
  #loaded = false;

  constructor(options: PersistentProjectRegistryOptions) {
    super();
    this.#filePath = options.filePath;
    this.#log = options.log;
  }

  #logEvent(level: string, event: string, fields: Record<string, unknown> = {}): void {
    this.#log?.(level, event, fields);
  }

  get isDirty(): boolean {
    return this.#dirty;
  }

  get isLoaded(): boolean {
    return this.#loaded;
  }

  /**
   * Disk'ten kayıtları yükler ve belleğe geri kurar.
   *
   * Her kayıt `register()`'dan geçtiği için canonical kök yeniden çözümlenir
   * ve symlink doğrulaması yeniden çalışır. Geri yüklenemeyen kayıtlar
   * (kök silinmiş, symlink'e dönmüş, bozuk config) tek tek atlanır ve
   * WARN ile loglanır — tek bozuk kayıt registry'nin tamamını çökertmez.
   */
  async load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;

    if (!existsSync(this.#filePath)) {
      this.#logEvent('INFO', 'project_registry.no_file', { path: this.#filePath });
      return;
    }

    try {
      const content = await readFile(this.#filePath, 'utf8');
      const data = JSON.parse(content) as PersistedProjectRegistryData;

      if (data.version !== 1) {
        this.#logEvent('WARN', 'project_registry.invalid_version', { version: data.version });
        return;
      }

      let restored = 0;
      let skipped = 0;
      for (const record of data.projects) {
        try {
          await super.register(
            record.id,
            {
              canonicalRoot: record.canonicalRoot,
              trustLevel: record.trustLevel,
              allowedBackends: record.allowedBackends,
              defaultBackend: record.defaultBackend,
            },
            record.registeredAt,
          );
          restored++;
        } catch (err) {
          skipped++;
          this.#logEvent('WARN', 'project_registry.restore_skipped', {
            project_id: record.id,
            error: err instanceof ProjectError ? err.code : err instanceof Error ? err.message : String(err),
          });
        }
      }

      this.#dirty = false;
      this.#logEvent('INFO', 'project_registry.loaded', {
        count: restored,
        skipped,
        updatedAt: data.updatedAt,
      });
    } catch (err) {
      this.#logEvent('ERROR', 'project_registry.load_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Registry'yi disk'e yazar. Atomic write: önce temp dosyasına yaz, sonra rename.
   */
  async save(): Promise<void> {
    const data: PersistedProjectRegistryData = {
      version: 1,
      updatedAt: new Date().toISOString(),
      projects: this.list().map((project) => ({
        id: project.id,
        canonicalRoot: project.canonicalRoot,
        trustLevel: project.trustLevel,
        allowedBackends: project.allowedBackends,
        defaultBackend: project.defaultBackend,
        registeredAt: project.registeredAt,
      })),
    };

    try {
      const dir = dirname(this.#filePath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      const tempPath = `${this.#filePath}.tmp.${randomBytes(8).toString('hex')}`;
      await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
      await rename(tempPath, this.#filePath);

      this.#dirty = false;
      this.#logEvent('DEBUG', 'project_registry.saved', { count: data.projects.length });
    } catch (err) {
      this.#logEvent('ERROR', 'project_registry.save_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** Değişiklik varsa disk'e yazar. */
  async flush(): Promise<void> {
    if (this.#dirty) {
      await this.save();
    }
  }

  /** Register override — kaydı kirletir. */
  override async register(
    id: string,
    definition: Parameters<ProjectRegistry['register']>[1],
    registeredAt?: string,
  ): Promise<RegisteredProject> {
    const project = await super.register(id, definition, registeredAt);
    this.#dirty = true;
    return project;
  }
}
