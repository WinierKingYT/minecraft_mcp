/**
 * Bridge HTTP istemcisi.
 *
 * Handshake dosyasından portu okur, token'ı ayrı dosyadan alır (BR-05: secret
 * handshake dosyasında bulunmaz) ve loopback üzerinden konuşur.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export interface Handshake {
  readonly bridge_protocol: number;
  readonly bridge_boot_id: string;
  readonly server_instance_id: string;
  readonly bind_address: string;
  readonly port: number;
  readonly started_at_millis: number;
}

/**
 * Bridge hatası.
 *
 * `code` bilinçli olarak geniş tiplidir: Bridge bir error catalog kodu
 * döndürdüğünde o kod OLDUĞU GİBİ taşınır. Sarmalayıcı bir koda (örneğin
 * `BRIDGE_REQUEST_FAILED`) çevirmek, `CHUNK_NOT_LOADED` veya
 * `TOOL_INPUT_INVALID` gibi teşhis edici kodları sınırda yutar ve KPI-08'i
 * (her hata kod + önerilen aksiyon taşır) anlamsız kılar.
 */
export class BridgeClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'BridgeClientError';
  }
}

export async function readHandshake(handshakeFile: string): Promise<Handshake> {
  if (!existsSync(handshakeFile)) {
    throw new BridgeClientError('BRIDGE_HANDSHAKE_FAILED', `Handshake dosyası yok: ${handshakeFile}`);
  }
  let parsed: Handshake;
  try {
    parsed = JSON.parse(await readFile(handshakeFile, 'utf8')) as Handshake;
  } catch (err) {
    throw new BridgeClientError(
      'BRIDGE_HANDSHAKE_FAILED',
      `Handshake dosyası ayrıştırılamadı: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof parsed.port !== 'number' || parsed.port <= 0 || typeof parsed.bridge_boot_id !== 'string') {
    throw new BridgeClientError('BRIDGE_HANDSHAKE_FAILED', 'Handshake dosyası eksik alan içeriyor.');
  }

  // Handshake dosyası secret TAŞIMAMALIDIR. Taşıyorsa bu bir sözleşme
  // ihlalidir ve sessizce geçilmez.
  const raw = JSON.stringify(parsed).toLowerCase();
  if (raw.includes('token') || raw.includes('secret')) {
    throw new BridgeClientError('BRIDGE_HANDSHAKE_FAILED', 'Handshake dosyası secret içeriyor (BR-05 ihlali).');
  }

  return parsed;
}

export class BridgeClient {
  readonly #baseUrl: string;
  readonly #token: string;

  constructor(port: number, token: string) {
    this.#baseUrl = `http://127.0.0.1:${port}`;
    this.#token = token;
  }

  async #request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.#token}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      throw new BridgeClientError(
        'BRIDGE_UNAVAILABLE',
        `Bridge'e ulaşılamadı: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const error = body['error'] as { code?: string; message?: string } | undefined;
      // Bridge'in kendi kodu korunur; yalnızca kod yoksa jenerik koda düşülür.
      throw new BridgeClientError(
        error?.code ?? 'BRIDGE_REQUEST_FAILED',
        error?.message ?? `Bridge isteği başarısız (HTTP ${response.status}).`,
        response.status,
      );
    }
    return body;
  }

  health(): Promise<Record<string, unknown>> {
    return this.#request('/v1/health');
  }

  capabilities(): Promise<Record<string, unknown>> {
    return this.#request('/v1/capabilities');
  }

  async query(operation: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const body = await this.#request('/v1/query', {
      method: 'POST',
      body: JSON.stringify({ operation, arguments: args }),
    });
    return (body['data'] ?? {}) as Record<string, unknown>;
  }

  async events(bootId: string, after = 0, limit = 100): Promise<Array<Record<string, unknown>>> {
    const params = new URLSearchParams({ boot_id: bootId, after: String(after), limit: String(limit) });
    const body = await this.#request(`/v1/events?${params.toString()}`);
    return (body['events'] ?? []) as Array<Record<string, unknown>>;
  }

  /**
   * Bridge üzerinden mutation action'ı çalıştırır.
   *
   * /v1/action endpoint'i, actor komutları ve world.set_block gibi
   * mutation'lar için kullanılır. Idempotency key gerektirir.
   */
  async action(operation: string, args: Record<string, unknown> = {}, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const body = await this.#request('/v1/action', {
      method: 'POST',
      body: JSON.stringify({
        operation,
        arguments: args,
        idempotency_key: idempotencyKey ?? null,
      }),
    });
    return (body['data'] ?? {}) as Record<string, unknown>;
  }
}
