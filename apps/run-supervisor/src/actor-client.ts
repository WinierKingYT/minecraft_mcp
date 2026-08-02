/**
 * Protocol test actor istemcisi.
 *
 * Actor, Paper sunucuya bağlanan sahte bir oyuncudur. Bridge üzerinden
 * komut gönderilir ve actor durumu bridge events ile izlenir.
 *
 * M2B koşullu milestone'dur (ADR-0006, SPIKE-ACTOR-001).
 */

import type { Position } from './scenario-parser.js';

// ─── Actor Types ──────────────────────────────────────────────────────────────

export interface ActorCreateParams {
  readonly id: string;
  readonly position?: Position;
}

export interface ActorBreakBlockParams {
  readonly actor: string;
  readonly position: Position;
}

export interface ActorMoveParams {
  readonly actor: string;
  readonly position: Position;
}

export interface ActorLookParams {
  readonly actor: string;
  readonly direction: string;
}

export interface ActorChatParams {
  readonly actor: string;
  readonly message: string;
}

export interface ActorPluginCommandParams {
  readonly actor: string;
  readonly command_id: string;
  readonly arguments?: Record<string, unknown>;
}

export interface ActorState {
  readonly id: string;
  readonly uuid: string;
  readonly position: Position;
  readonly gamemode: string;
  readonly health: number;
  readonly connected: boolean;
}

export interface ActorActionResult {
  readonly success: boolean;
  readonly actor_id: string;
  readonly message?: string;
  readonly state?: ActorState;
}

// ─── Actor Client ─────────────────────────────────────────────────────────────

/**
 * Bridge üzerinden actor komutlarını çalıştıran istemci.
 *
 * Actor komutları bridge'in /v1/action endpoint'ine gönderilir.
 * Bridge, actor'ı Paper API üzerinden yönetir (sahte oyuncu oluşturma,
 * blok kırma, komut çalıştırma vb.).
 */
export class ActorClient {
  readonly #actionFn: (operation: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

  constructor(actionFn: (operation: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>) {
    this.#actionFn = actionFn;
  }

  /**
   * Test actor oluşturur.
   */
  async createActor(params: ActorCreateParams): Promise<ActorActionResult> {
    const result = await this.#actionFn('test_actor.create', {
      actor_id: params.id,
      position: params.position,
    });

    const message = result['message'] as string | undefined;
    const state = result['state'] as ActorState | undefined;

    return {
      success: result['success'] as boolean ?? true,
      actor_id: params.id,
      ...(message !== undefined && { message }),
      ...(state !== undefined && { state }),
    };
  }

  /**
   * Tüm test actor'ları bağlantıdan keser.
   */
  async disconnectAll(): Promise<void> {
    await this.#actionFn('test_actor.disconnect_all', {});
  }

  /**
   * Actor'a blok kırdırır.
   */
  async breakBlock(params: ActorBreakBlockParams): Promise<ActorActionResult> {
    const result = await this.#actionFn('player.break_block', {
      actor_id: params.actor,
      position: params.position,
    });

    const message = result['message'] as string | undefined;

    return {
      success: result['success'] as boolean ?? true,
      actor_id: params.actor,
      ...(message !== undefined && { message }),
    };
  }

  /**
   * Actor'u hareket ettirir.
   */
  async move(params: ActorMoveParams): Promise<ActorActionResult> {
    const result = await this.#actionFn('player.move', {
      actor_id: params.actor,
      position: params.position,
    });

    const message = result['message'] as string | undefined;

    return {
      success: result['success'] as boolean ?? true,
      actor_id: params.actor,
      ...(message !== undefined && { message }),
    };
  }

  /**
   * Actor'un baktığı yönü değiştirir.
   */
  async look(params: ActorLookParams): Promise<ActorActionResult> {
    const result = await this.#actionFn('player.look', {
      actor_id: params.actor,
      direction: params.direction,
    });

    const message = result['message'] as string | undefined;

    return {
      success: result['success'] as boolean ?? true,
      actor_id: params.actor,
      ...(message !== undefined && { message }),
    };
  }

  /**
   * Actor'a mesaj gönderir.
   */
  async chat(params: ActorChatParams): Promise<ActorActionResult> {
    const result = await this.#actionFn('player.chat', {
      actor_id: params.actor,
      message: params.message,
    });

    const message = result['message'] as string | undefined;

    return {
      success: result['success'] as boolean ?? true,
      actor_id: params.actor,
      ...(message !== undefined && { message }),
    };
  }

  /**
   * Actor'a plugin komutu çalıştırır.
   */
  async pluginCommand(params: ActorPluginCommandParams): Promise<ActorActionResult> {
    const result = await this.#actionFn('plugin.command', {
      actor_id: params.actor,
      command_id: params.command_id,
      arguments: params.arguments,
    });

    const message = result['message'] as string | undefined;

    return {
      success: result['success'] as boolean ?? true,
      actor_id: params.actor,
      ...(message !== undefined && { message }),
    };
  }

  /**
   * Actor durumunu sorgular.
   */
  async getState(actorId: string): Promise<ActorState | null> {
    const result = await this.#actionFn('player.get_state', {
      actor_id: actorId,
    });

    if (!result['found']) {
      return null;
    }

    return {
      id: result['id'] as string,
      uuid: result['uuid'] as string,
      position: result['position'] as Position,
      gamemode: result['gamemode'] as string,
      health: result['health'] as number,
      connected: result['connected'] as boolean,
    };
  }
}

// ─── Actor Error Codes ────────────────────────────────────────────────────────

export class ActorError extends Error {
  constructor(
    readonly code: 'ACTOR_UNAVAILABLE' | 'ACTOR_LOGIN_FAILED' | 'ACTOR_CRASHED' | 'PLAYER_NOT_FOUND',
    message: string,
    readonly suggestedAction?: string,
  ) {
    super(message);
    this.name = 'ActorError';
  }
}
