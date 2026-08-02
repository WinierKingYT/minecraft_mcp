/**
 * Yerel `stdio` taşıması — satır sonlandırmalı JSON-RPC 2.0.
 *
 * ADR-0002: V1 yalnızca yerel stdio destekler. Remote HTTP ve OAuth V2 adayıdır.
 *
 * Yazma yalnızca StdoutGuard üzerinden yapılır; başka hiçbir kod yolu stdout'a
 * erişemez (docs/contracts/mcp.md).
 */

import { createInterface, type Interface } from 'node:readline';
import type { StdoutGuard } from './stdout-guard.js';
import {
  JSON_RPC,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type RequestHandler,
  type TransportAdapter,
} from './types.js';
import { log } from '../logging.js';

export class StdioTransport implements TransportAdapter {
  readonly #guard: StdoutGuard;
  #rl: Interface | null = null;
  #closed = false;

  constructor(guard: StdoutGuard) {
    this.#guard = guard;
  }

  listen(handler: RequestHandler): void {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    this.#rl = rl;

    rl.on('line', (line) => {
      void this.#handleLine(line, handler);
    });

    rl.on('close', () => {
      log('INFO', 'transport.stdin.closed', {});
      if (!this.#closed) process.exit(0);
    });
  }

  async #handleLine(line: string, handler: RequestHandler): Promise<void> {
    const trimmed = line.trim();
    if (trimmed === '') return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      // Parse hatasında id bilinmez; spec gereği null id ile yanıtla.
      this.#send({
        jsonrpc: '2.0',
        id: null,
        error: { code: JSON_RPC.PARSE_ERROR, message: 'Parse error' },
      });
      return;
    }

    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      this.#send({
        jsonrpc: '2.0',
        id: request?.id ?? null,
        error: { code: JSON_RPC.INVALID_REQUEST, message: 'Invalid Request' },
      });
      return;
    }

    try {
      const response = await handler(request);
      // Notification (id yok) -> yanıt yazılmaz.
      if (response !== null) this.#send(response);
    } catch (err) {
      log('ERROR', 'transport.handler.threw', {
        method: request.method,
        message: err instanceof Error ? err.message : String(err),
      });
      if (request.id !== undefined) {
        this.#send({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: JSON_RPC.INTERNAL_ERROR, message: 'Internal error' },
        });
      }
    }
  }

  #send(response: JsonRpcResponse): void {
    this.#guard.writeProtocolMessage(JSON.stringify(response) + '\n');
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#rl?.close();
    this.#rl = null;
  }
}
