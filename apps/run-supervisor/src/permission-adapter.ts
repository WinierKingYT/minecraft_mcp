import { EventEmitter } from 'node:events';

export interface PermissionAdapterOptions {
  readonly provider: 'native' | 'luckperms';
  readonly bridgeClient: {
    action: (operation: string, args: Record<string, unknown>, idempotencyKey?: string) => Promise<unknown>;
    query: (operation: string, args: Record<string, unknown>) => Promise<unknown>;
  };
}

export interface PermissionAttachment {
  readonly attachmentId: string;
  readonly playerName: string;
  readonly permission: string;
  readonly value: boolean;
  readonly createdAt: number;
  readonly expiresAt: number | null;
}

export interface PermissionCheckResult {
  readonly player: string;
  readonly permission: string;
  readonly hasPermission: boolean;
  readonly source: 'attachment' | 'default' | 'luckperms' | 'op';
}

export class PermissionAdapter extends EventEmitter {
  #options: PermissionAdapterOptions;
  #attachments = new Map<string, PermissionAttachment>();
  #nextId = 1;

  constructor(options: PermissionAdapterOptions) {
    super();
    this.#options = options;
  }

  get provider(): string {
    return this.#options.provider;
  }

  async attachPermission(player: string, permission: string, value: boolean = true, durationMs?: number): Promise<PermissionAttachment> {
    const attachmentId = `perm_${this.#nextId++}`;
    const attachment: PermissionAttachment = {
      attachmentId,
      playerName: player,
      permission,
      value,
      createdAt: Date.now(),
      expiresAt: durationMs ? Date.now() + durationMs : null,
    };

    this.#attachments.set(attachmentId, attachment);

    if (this.#options.provider === 'native') {
      await this.#options.bridgeClient.action('permission.attach', {
        player,
        permission,
        value,
        durationMs,
      }, `perm_attach_${attachmentId}`);
    } else if (this.#options.provider === 'luckperms') {
      await this.#options.bridgeClient.action('luckperms.permission.attach', {
        player,
        permission,
        value,
        durationMs,
      }, `luckperms_attach_${attachmentId}`);
    }

    this.emit('attached', attachment);
    return attachment;
  }

  async detachPermission(attachmentId: string): Promise<void> {
    const attachment = this.#attachments.get(attachmentId);
    if (!attachment) {
      throw new Error(`Attachment not found: ${attachmentId}`);
    }

    if (this.#options.provider === 'native') {
      await this.#options.bridgeClient.action('permission.detach', {
        attachmentId,
      }, `perm_detach_${attachmentId}`);
    } else if (this.#options.provider === 'luckperms') {
      await this.#options.bridgeClient.action('luckperms.permission.detach', {
        attachmentId,
      }, `luckperms_detach_${attachmentId}`);
    }

    this.#attachments.delete(attachmentId);
    this.emit('detached', attachment);
  }

  async checkPermission(player: string, permission: string): Promise<PermissionCheckResult> {
    if (this.#options.provider === 'native') {
      const result = await this.#options.bridgeClient.query('permission.check', {
        player,
        permission,
      }) as PermissionCheckResult;
      return result;
    } else if (this.#options.provider === 'luckperms') {
      const result = await this.#options.bridgeClient.query('luckperms.permission.check', {
        player,
        permission,
      }) as PermissionCheckResult;
      return result;
    }

    throw new Error(`Unsupported provider: ${this.#options.provider}`);
  }

  async setOp(player: string, value: boolean): Promise<void> {
    if (this.#options.provider === 'native') {
      await this.#options.bridgeClient.action('player.set_op', {
        player,
        value,
      }, `player_setop_${player}_${value}`);
    } else if (this.#options.provider === 'luckperms') {
      await this.#options.bridgeClient.action('luckperms.player.set_op', {
        player,
        value,
      }, `luckperms_setop_${player}_${value}`);
    }
  }

  async getPlayerPermissions(player: string): Promise<PermissionAttachment[]> {
    return Array.from(this.#attachments.values()).filter(
      (a) => a.playerName === player && (a.expiresAt === null || a.expiresAt > Date.now()),
    );
  }

  clearPlayerPermissions(player: string): void {
    for (const [id, attachment] of this.#attachments) {
      if (attachment.playerName === player) {
        this.#attachments.delete(id);
      }
    }
  }

  destroy(): void {
    this.#attachments.clear();
    this.removeAllListeners();
  }
}
