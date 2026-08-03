/**
 * Supervisor IPC sunucusu.
 *
 * Yerel bir socket/named pipe dinler ve tipli metotları dağıtır.
 * Serbest komut yüzeyi YOKTUR: her metot adı sabit listeden gelir ve tipli
 * parametre alır.
 */

import { createServer, type Server, type Socket } from 'node:net';
import {
  NdjsonDecoder,
  encodeFrame,
  FrameTooLargeError,
  IPC_MAX_MESSAGE_BYTES,
  type IpcError,
  type IpcMethod,
  type IpcRequest,
  type IpcResponse,
} from '@mcpdev/contracts';

export type MethodHandler = (params: unknown) => Promise<unknown>;

export interface IpcServerOptions {
  readonly endpointPath: string;
  readonly token: string;
  readonly handlers: Readonly<Record<IpcMethod, MethodHandler>>;
  readonly log?: (level: string, event: string, fields: Record<string, unknown>) => void;
}

const KNOWN_METHODS: readonly IpcMethod[] = [
  'supervisor.health',
  'runtime.create',
  'runtime.launch',
  'runtime.get',
  'runtime.stop',
  'runtime.release',
  'bridge.query',
  'bridge.events',
  'project.inspect',
  'project.validate',
  'build.run',
  'plugin.diagnose',
  'scenario.run',
  'evidence.get',
  'events.subscribe',
  'events.unsubscribe',
  'events.list',
  'pool.status',
  'pool.acquire',
  'pool.release',
  'pool.evict',
  'pool.list',
  'pool.reset',
  'profile.list',
  'profile.get',
  'permission.attach',
  'permission.detach',
  'permission.check',
  'permission.set_op',
];

/** Hata nesnesinden IPC hatası üretir; kod yoksa güvenli varsayılana düşer. */
export function toIpcError(err: unknown): IpcError {
  const code =
    typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string'
      ? (err as { code: string }).code
      : 'SUPERVISOR_INTERNAL_ERROR';

  const message = err instanceof Error ? err.message : String(err);

  // Yeniden denenebilirlik, error catalog'daki anlamla hizalı tutulur.
  const retryable = code === 'BRIDGE_BUSY' || code === 'RUNTIME_QUOTA_EXCEEDED';

  return {
    code,
    message,
    retryable,
    suggested_action:
      code === 'SUPERVISOR_INTERNAL_ERROR'
        ? 'Supervisor stderr loglarını inceleyin; hata beklenen bir sınıfa ait değil.'
        : 'Hata koduna karşılık gelen error catalog kaydındaki aksiyonu izleyin.',
  };
}

export class SupervisorIpcServer {
  readonly #options: IpcServerOptions;
  readonly #sockets = new Set<Socket>();
  #server: Server | null = null;

  constructor(options: IpcServerOptions) {
    this.#options = options;
  }

  #log(level: string, event: string, fields: Record<string, unknown> = {}): void {
    this.#options.log?.(level, event, fields);
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.#onConnection(socket));
      this.#server = server;

      server.on('error', reject);
      server.listen(this.#options.endpointPath, () => {
        server.off('error', reject);
        this.#log('INFO', 'ipc.listening', { endpoint: this.#options.endpointPath });
        resolve();
      });
    });
  }

  #onConnection(socket: Socket): void {
    this.#sockets.add(socket);
    socket.setEncoding('utf8');

    const decoder = new NdjsonDecoder(IPC_MAX_MESSAGE_BYTES);
    let authenticated = false;

    socket.on('data', (chunk: string) => {
      let lines: string[];
      try {
        lines = decoder.push(chunk);
      } catch (err) {
        if (err instanceof FrameTooLargeError) {
          this.#log('WARN', 'ipc.frame_too_large', { limit: err.limitBytes });
          socket.destroy();
          return;
        }
        socket.destroy();
        return;
      }

      for (const line of lines) {
        void this.#handleLine(socket, line, authenticated).then((nowAuthenticated) => {
          authenticated = authenticated || nowAuthenticated;
        });
      }
    });

    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.#sockets.delete(socket));
  }

  async #handleLine(socket: Socket, line: string, authenticated: boolean): Promise<boolean> {
    let request: IpcRequest & { token?: unknown };
    try {
      request = JSON.parse(line) as IpcRequest & { token?: unknown };
    } catch {
      this.#send(socket, {
        v: 1,
        id: 'unknown',
        ok: false,
        error: {
          code: 'TOOL_INPUT_INVALID',
          message: 'IPC çerçevesi ayrıştırılamadı.',
          retryable: false,
          suggested_action: 'Geçerli JSON gönderin.',
        },
      });
      return authenticated;
    }

    const id = typeof request.id === 'string' ? request.id : 'unknown';

    if (request.v !== 1) {
      this.#send(socket, {
        v: 1,
        id,
        ok: false,
        error: {
          code: 'IPC_VERSION_UNSUPPORTED',
          message: `IPC sürümü desteklenmiyor: ${String(request.v)}`,
          retryable: false,
          suggested_action: 'MCP Server ve Supervisor sürümlerini eşitleyin.',
        },
      });
      return authenticated;
    }

    // Token her istekte taşınır: bağlantı başına tek doğrulama, socket'in
    // devredilmesi hâlinde yetkiyi taşırdı.
    if (typeof request.token !== 'string' || !this.#tokenMatches(request.token)) {
      this.#log('WARN', 'ipc.unauthorized', { method: request.method });
      this.#send(socket, {
        v: 1,
        id,
        ok: false,
        error: {
          code: 'BRIDGE_UNAUTHORIZED',
          message: 'Geçersiz IPC token.',
          retryable: false,
          suggested_action: 'Supervisor kontrol dosyasındaki token ile bağlanın.',
        },
      });
      return authenticated;
    }

    if (!KNOWN_METHODS.includes(request.method)) {
      this.#send(socket, {
        v: 1,
        id,
        ok: false,
        error: {
          code: 'UNKNOWN_TOOL',
          message: `Bilinmeyen IPC metodu: ${String(request.method)}`,
          retryable: false,
          suggested_action: 'Desteklenen metot listesini kontrol edin.',
        },
      });
      return true;
    }

    try {
      const result = await this.#options.handlers[request.method](request.params);
      this.#send(socket, { v: 1, id, ok: true, result });
    } catch (err) {
      const error = toIpcError(err);
      this.#log('WARN', 'ipc.method_failed', { method: request.method, code: error.code });
      this.#send(socket, { v: 1, id, ok: false, error });
    }
    return true;
  }

  /** Sabit süreli karşılaştırma; token uzunluğu/öneki zamanlamayla sızmasın. */
  #tokenMatches(presented: string): boolean {
    const expected = this.#options.token;
    if (presented.length !== expected.length) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
    }
    return diff === 0;
  }

  #send(socket: Socket, response: IpcResponse): void {
    try {
      socket.write(encodeFrame(response, IPC_MAX_MESSAGE_BYTES));
    } catch {
      socket.destroy();
    }
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) {
      socket.destroy();
    }
    this.#sockets.clear();

    const server = this.#server;
    this.#server = null;
    if (!server) return;

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
