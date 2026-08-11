/**
 * Run Supervisor IPC istemcisi.
 *
 * ADR-0003: MCP Server Supervisor'ı **doğurmaz**, ona bağlanır. Supervisor
 * bulunamazsa bu bir hata durumudur ve gizlenmez — MCP Server kendi başına
 * Paper başlatmaya kalkışmaz.
 */

import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  NdjsonDecoder,
  encodeFrame,
  IPC_DEFAULT_TIMEOUT_MS,
  IPC_MAX_MESSAGE_BYTES,
  type IpcMethod,
  type IpcResponse,
} from '@mcpdev/contracts';
import { log } from './logging.js';

export class SupervisorUnavailableError extends Error {
  readonly code = 'SUPERVISOR_UNAVAILABLE' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SupervisorUnavailableError';
  }
}

export class SupervisorCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly suggestedAction: string,
  ) {
    super(message);
    this.name = 'SupervisorCallError';
  }
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly timer: NodeJS.Timeout;
}

export interface SupervisorClientOptions {
  readonly endpointPath: string;
  readonly token: string;
  readonly defaultTimeoutMs?: number;
}

export class SupervisorClient {
  readonly #options: SupervisorClientOptions;
  readonly #pending = new Map<string, Pending>();
  #socket: Socket | null = null;
  #connecting: Promise<Socket> | null = null;

  constructor(options: SupervisorClientOptions) {
    this.#options = options;
  }

  async #ensureSocket(): Promise<Socket> {
    if (this.#socket && !this.#socket.destroyed) {
      return this.#socket;
    }
    this.#connecting ??= this.#connect().finally(() => {
      this.#connecting = null;
    });
    return this.#connecting;
  }

  #connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.#options.endpointPath);
      const decoder = new NdjsonDecoder(IPC_MAX_MESSAGE_BYTES);

      socket.setEncoding('utf8');

      const onError = (err: Error): void => {
        reject(new SupervisorUnavailableError(`Supervisor'a bağlanılamadı: ${err.message}`));
      };
      socket.once('error', onError);

      socket.once('connect', () => {
        socket.off('error', onError);
        this.#socket = socket;

        socket.on('data', (chunk: string) => {
          let lines: string[];
          try {
            lines = decoder.push(chunk);
          } catch (err) {
            this.#failAll(err);
            socket.destroy();
            return;
          }
          for (const line of lines) {
            this.#onResponse(line);
          }
        });

        socket.on('error', (err) => {
          log('WARN', 'supervisor.socket_error', { message: err.message });
          this.#failAll(new SupervisorUnavailableError(`Supervisor bağlantısı koptu: ${err.message}`));
        });

        socket.on('close', () => {
          this.#socket = null;
          // Bekleyen çağrılar askıda kalmamalı: bağlantı koptuysa hepsi düşer.
          this.#failAll(new SupervisorUnavailableError('Supervisor bağlantısı kapandı.'));
        });

        resolve(socket);
      });
    });
  }

  #onResponse(line: string): void {
    let response: IpcResponse;
    try {
      response = JSON.parse(line) as IpcResponse;
    } catch {
      log('WARN', 'supervisor.bad_frame', {});
      return;
    }

    const pending = this.#pending.get(response.id);
    if (!pending) {
      // Süresi geçmiş bir isteğin geç yanıtı; sessizce yok sayılır fakat
      // loglanır — sessiz kalmak teşhisi zorlaştırırdı.
      log('DEBUG', 'supervisor.late_response', { id: response.id });
      return;
    }
    this.#pending.delete(response.id);
    clearTimeout(pending.timer);

    if (response.ok) {
      pending.resolve(response.result);
    } else {
      pending.reject(
        new SupervisorCallError(
          response.error.code,
          response.error.message,
          response.error.retryable,
          response.error.suggested_action,
        ),
      );
    }
  }

  #failAll(reason: unknown): void {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
  }

  async call<TResult>(method: IpcMethod, params: unknown, timeoutMs?: number): Promise<TResult> {
    const socket = await this.#ensureSocket();
    const id = randomUUID();
    const limit = timeoutMs ?? this.#options.defaultTimeoutMs ?? IPC_DEFAULT_TIMEOUT_MS;

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new SupervisorCallError(
            'SUPERVISOR_TIMEOUT',
            `Supervisor çağrısı ${limit} ms içinde yanıtlamadı: ${method}`,
            true,
            'Supervisor loglarını inceleyin veya işlemi daha uzun bir süreyle tekrarlayın.',
          ),
        );
      }, limit);

      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });

      try {
        socket.write(encodeFrame({ v: 1, id, method, params, token: this.#options.token }, IPC_MAX_MESSAGE_BYTES));
      } catch (err) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  close(): void {
    this.#failAll(new SupervisorUnavailableError('İstemci kapatıldı.'));
    this.#socket?.destroy();
    this.#socket = null;
  }

  /** Devam eden (yanıtı bekleyen) IPC çağrısı sayısı. */
  get pendingCount(): number {
    return this.#pending.size;
  }
}
