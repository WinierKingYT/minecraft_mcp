/**
 * MCP Server — protokol revizyonu 2026-07-28 (stateless).
 *
 * ÖNEMLİ: Bu revizyon `initialize` / `notifications/initialized` el sıkışmasını
 * ve `Mcp-Session-Id` başlığını KALDIRMIŞTIR. Protokol artık request/response
 * stateless'tır:
 *
 *   - Her istek kendi protokol sürümünü, istemci kimliğini ve istemci
 *     capability'lerini `_meta` içinde taşır.
 *   - Sunucu capability'lerini öğrenmek isteyen istemci OPSİYONEL `server/discover`
 *     çağırabilir; zorunlu değildir.
 *   - `tools/list` sonuçları `ttlMs` + `cacheScope` ile önbelleklenebilir.
 *   - Uzun etkileşim için Multi Round-Trip Requests: sunucu
 *     `resultType: "input_required"` döndürür, istemci `inputResponses` ile
 *     yeniden dener.
 *
 * ADR-0002: SDK'ya bağımlılık henüz kurulmadı; protokol yüzeyi TransportAdapter
 * arkasında kendi implementasyonumuzdur. Stable @modelcontextprotocol/server@2.0.0
 * yayınlanmıştır ve ADR-0002 revizyonu ile bu dosyanın yerini alması beklenir.
 */

import { JSON_RPC, type JsonRpcRequest, type JsonRpcResponse, type TransportAdapter } from './transport/types.js';
import { ToolFacade } from './tools/facade.js';
import { log } from './logging.js';

/** tools/list önbellek ömrü. Tool listesi yalnızca profil/config reload ile değişir. */
const TOOL_LIST_TTL_MS = 300_000;

export interface ServerOptions {
  readonly name: string;
  readonly version: string;
  readonly protocolVersion: string;
  readonly facade: ToolFacade;
  readonly transport: TransportAdapter;
}

/** İstek başına taşınan istemci bağlamı (stateless çekirdek). */
interface RequestMeta {
  readonly protocolVersion?: string;
  readonly clientName?: string;
  readonly clientVersion?: string;
}

function readMeta(params: unknown): RequestMeta {
  const meta = (params as { _meta?: Record<string, unknown> } | undefined)?._meta;
  if (!meta || typeof meta !== 'object') return {};

  const client = meta['client'] as { name?: unknown; version?: unknown } | undefined;
  return {
    ...(typeof meta['protocolVersion'] === 'string' ? { protocolVersion: meta['protocolVersion'] } : {}),
    ...(typeof client?.name === 'string' ? { clientName: client.name } : {}),
    ...(typeof client?.version === 'string' ? { clientVersion: client.version } : {}),
  };
}

export class McpServer {
  readonly #opts: ServerOptions;

  constructor(opts: ServerOptions) {
    this.#opts = opts;
  }

  start(): void {
    this.#opts.transport.listen((request) => this.#dispatch(request));
    log('INFO', 'server.started', {
      name: this.#opts.name,
      version: this.#opts.version,
      protocol_version: this.#opts.protocolVersion,
      protocol_mode: 'stateless',
      tool_profile: this.#opts.facade.profile,
    });
  }

  async #dispatch(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const isNotification = request.id === undefined;
    const id = request.id ?? null;
    const meta = readMeta(request.params);

    // Sürüm uyuşmazlığı sessizce kabul edilmez: istemci farklı bir revizyon
    // beyan ediyorsa bunu loglarız. Reddetmeyiz — spec geriye dönük uyumluluk
    // için sunucunun toleranslı olmasını bekler.
    if (meta.protocolVersion !== undefined && meta.protocolVersion !== this.#opts.protocolVersion) {
      log('WARN', 'protocol.version.mismatch', {
        client_declared: meta.protocolVersion,
        server_supports: this.#opts.protocolVersion,
        method: request.method,
      });
    }

    switch (request.method) {
      // Opsiyonel keşif RPC'si. initialize'ın yerini ALMAZ: zorunlu değildir ve
      // durum oluşturmaz.
      case 'server/discover':
        return this.#discover(id);

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      case 'tools/list':
        return this.#listTools(id);

      case 'tools/call':
        return this.#callTool(id, request.params);

      // Kaldırılmış metotlar. Sessizce kabul etmek, eski bir istemcinin
      // stateful davrandığını sanmasına yol açardı.
      case 'initialize':
      case 'notifications/initialized':
        log('WARN', 'protocol.removed_method', { method: request.method });
        if (isNotification) return null;
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: JSON_RPC.METHOD_NOT_FOUND,
            message:
              `"${request.method}" protokol revizyonu ${this.#opts.protocolVersion} ile kaldırılmıştır. ` +
              'Protokol stateless\'tır; capability keşfi için server/discover kullanın (opsiyonel).',
          },
        };

      default:
        // Bilinmeyen method domain error'a ÇEVRİLMEZ (docs/contracts/mcp.md).
        if (isNotification) return null;
        return {
          jsonrpc: '2.0',
          id,
          error: { code: JSON_RPC.METHOD_NOT_FOUND, message: `Method not found: ${request.method}` },
        };
    }
  }

  #discover(id: JsonRpcResponse['id']): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: this.#opts.protocolVersion,
        serverInfo: {
          name: this.#opts.name,
          version: this.#opts.version,
        },
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: false, listChanged: false },
        },
      },
    };
  }

  #listTools(id: JsonRpcResponse['id']): JsonRpcResponse {
    // TL-04: sıra profiles.yaml'daki sıradır ve çağrılar arasında değişmez.
    const tools = this.#opts.facade.listTools().map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
    }));

    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools,
        // Önbelleklenebilir liste sonucu. Tool listesi yalnızca açık bir
        // profil/config reload ile değişir (TL-05), bu yüzden önbellek
        // güvenlidir ve kapsamı sunucudur.
        ttlMs: TOOL_LIST_TTL_MS,
        cacheScope: 'server',
      },
    };
  }

  async #callTool(id: JsonRpcResponse['id'], params: unknown): Promise<JsonRpcResponse> {
    const p = params as { name?: unknown; arguments?: unknown } | undefined;

    if (typeof p?.name !== 'string') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: JSON_RPC.INVALID_PARAMS, message: 'params.name (string) zorunludur.' },
      };
    }

    if (!this.#opts.facade.has(p.name)) {
      // Profilde olmayan tool = protokol hatası, domain hatası değil.
      return {
        jsonrpc: '2.0',
        id,
        error: { code: JSON_RPC.METHOD_NOT_FOUND, message: `Unknown tool: ${p.name}` },
      };
    }

    const rawArgs = p.arguments ?? {};
    if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: JSON_RPC.INVALID_PARAMS, message: 'params.arguments bir nesne olmalıdır.' },
      };
    }

    const result = await this.#opts.facade.call(p.name, rawArgs as Record<string, unknown>);

    log(result.isError ? 'WARN' : 'INFO', 'tool.called', {
      tool: p.name,
      is_error: result.isError,
      correlation_id: result.structuredContent.correlation_id,
      ...(result.structuredContent.status === 'error' ? { error_code: result.structuredContent.error.code } : {}),
    });

    return { jsonrpc: '2.0', id, result };
  }
}
