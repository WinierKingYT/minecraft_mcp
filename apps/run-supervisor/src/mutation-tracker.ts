/**
 * Bridge Mutation Tracking.
 *
 * Bridge üzerinden yapılan yazma işlemlerinin (mutation) izlenmesi ve
 * idempotency kontrolü. Her mutation benzersiz bir ID ile işaretlenir
 * ve tekrarlanabilirlik sağlanır.
 */

import { randomBytes } from 'node:crypto';

export type MutationType = 'world.set_block' | 'world.break_block' | 'player.teleport' | 'plugin.reload';

export type MutationStatus = 'pending' | 'applied' | 'reverted' | 'failed';

export interface MutationRecord {
  readonly id: string;
  readonly type: MutationType;
  readonly runtimeId: string;
  readonly timestamp: number;
  readonly args: Record<string, unknown>;
  status: MutationStatus;
  readonly idempotencyKey: string;
  revertData?: Record<string, unknown>;
  error?: string;
}

export interface MutationOptions {
  /** Idempotency key sağlanmazsa otomatik üretilir. */
  readonly idempotencyKey?: string;
  /** Mutation timeout süresi (ms). */
  readonly timeoutMs?: number;
}

/**
 * Mutation store — tüm mutation'ları bellekte tutar.
 * M1'de SQLite'e taşınacaktır.
 */
export class MutationStore {
  readonly #mutations = new Map<string, MutationRecord>();
  readonly #byIdempotencyKey = new Map<string, MutationRecord>();

  /**
   * Yeni bir mutation kaydı oluşturur.
   */
  create(
    type: MutationType,
    runtimeId: string,
    args: Record<string, unknown>,
    options: MutationOptions = {},
  ): MutationRecord {
    const id = `mut_${Date.now()}_${randomBytes(12).toString('hex')}`;
    const idempotencyKey = options.idempotencyKey ?? `idem_${id}`;

    // Idempotency kontrolü — aynı key ile daha önce mutation yapılmış mı?
    const existing = this.#byIdempotencyKey.get(idempotencyKey);
    if (existing) {
      return existing;
    }

    const record: MutationRecord = {
      id,
      type,
      runtimeId,
      timestamp: Date.now(),
      args,
      status: 'pending',
      idempotencyKey,
    };

    this.#mutations.set(id, record);
    this.#byIdempotencyKey.set(idempotencyKey, record);
    return record;
  }

  /**
   * Mutation durumunu günceller.
   */
  updateStatus(id: string, status: MutationStatus, error?: string): void {
    const record = this.#mutations.get(id);
    if (!record) return;

    record.status = status;
    if (error) record.error = error;
  }

  /**
   * Mutation'ı geri almak için veri kaydeder.
   */
  setRevertData(id: string, data: Record<string, unknown>): void {
    const record = this.#mutations.get(id);
    if (!record) return;

    record.revertData = data;
  }

  /**
   * Mutation kaydını getirir.
   */
  get(id: string): MutationRecord | undefined {
    return this.#mutations.get(id);
  }

  /**
   * Idempotency key ile mutation getirir.
   */
  getByIdempotencyKey(key: string): MutationRecord | undefined {
    return this.#byIdempotencyKey.get(key);
  }

  /**
   * Belirli bir runtime'a ait tüm mutation'ları listeler.
   */
  listByRuntime(runtimeId: string): MutationRecord[] {
    return [...this.#mutations.values()].filter((m) => m.runtimeId === runtimeId);
  }

  /**
   * Pending mutation'ları listeler.
   */
  listPending(): MutationRecord[] {
    return [...this.#mutations.values()].filter((m) => m.status === 'pending');
  }

  /**
   * Mutation sayısını döndürür.
   */
  get size(): number {
    return this.#mutations.size;
  }
}

/**
 * Bridge mutation handler — world.set_block gibi işlemler için.
 */
export class MutationHandler {
  readonly #store: MutationStore;
  readonly #bridgeQuery: (runtimeId: string, operation: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

  constructor(
    store: MutationStore,
    bridgeQuery: (runtimeId: string, operation: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ) {
    this.#store = store;
    this.#bridgeQuery = bridgeQuery;
  }

  /**
   * World set block işlemini gerçekleştirir.
   */
  async setBlock(
    runtimeId: string,
    position: { world: string; x: number; y: number; z: number },
    material: string,
    options: MutationOptions = {},
  ): Promise<MutationRecord> {
    // Idempotency kontrolü
    const idempotencyKey = options.idempotencyKey ?? `set_block:${runtimeId}:${position.world}:${position.x}:${position.y}:${position.z}:${material}`;
    const existing = this.#store.getByIdempotencyKey(idempotencyKey);
    if (existing && existing.status === 'applied') {
      return existing;
    }

    // Mutation oluştur
    const mutation = this.#store.create('world.set_block', runtimeId, {
      position,
      material,
    }, { idempotencyKey });

    try {
      // Mevcut blok durumunu kaydet (geri alma için)
      const currentBlock = await this.#bridgeQuery(runtimeId, 'get_block', {
        world: position.world,
        x: position.x,
        y: position.y,
        z: position.z,
      });

      this.#store.setRevertData(mutation.id, {
        previousMaterial: currentBlock['material'],
      });

      // Bloğu yerleştir
      await this.#bridgeQuery(runtimeId, 'set_block', {
        world: position.world,
        x: position.x,
        y: position.y,
        z: position.z,
        material,
      });

      this.#store.updateStatus(mutation.id, 'applied');
    } catch (err) {
      this.#store.updateStatus(mutation.id, 'failed', err instanceof Error ? err.message : String(err));
      throw err;
    }

    return mutation;
  }

  /**
   * Mutation'ı geri alır.
   */
  async revert(mutationId: string): Promise<void> {
    const mutation = this.#store.get(mutationId);
    if (!mutation) {
      throw Object.assign(new Error(`Mutation bulunamadı: ${mutationId}`), { code: 'EVIDENCE_NOT_FOUND' });
    }

    if (mutation.status !== 'applied') {
      throw Object.assign(new Error(`Mutation geri alınamaz durumda: ${mutation.status}`), { code: 'RUNTIME_INVALID_STATE' });
    }

    if (!mutation.revertData) {
      throw Object.assign(new Error('Geri alma verisi mevcut değil.'), { code: 'EVIDENCE_NOT_FOUND' });
    }

    try {
      const position = mutation.args['position'] as { world: string; x: number; y: number; z: number };
      const previousMaterial = mutation.revertData['previousMaterial'] as string;

      await this.#bridgeQuery(mutation.runtimeId, 'set_block', {
        world: position.world,
        x: position.x,
        y: position.y,
        z: position.z,
        material: previousMaterial,
      });

      this.#store.updateStatus(mutation.id, 'reverted');
    } catch (err) {
      this.#store.updateStatus(mutation.id, 'failed', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /**
   * Belirli bir runtime'a ait tüm mutation'ları geri alır.
   */
  async revertAll(runtimeId: string): Promise<void> {
    const mutations = this.#store.listByRuntime(runtimeId);
    const applied = mutations.filter((m) => m.status === 'applied');

    // Ters sırada geri al (son eklenen ilk önce geri alınır)
    for (const mutation of applied.reverse()) {
      try {
        await this.revert(mutation.id);
      } catch {
        // Geri alma başarısız olursa devam et
      }
    }
  }
}
