/**
 * TransportAdapter seam — ADR-0002.
 *
 * Prototip aşamasında resmî MCP SDK'ya bağımlılık KURULMAZ: uyumluluk
 * profilindeki alpha SDK sürümleri doğrulanmamıştır ve stdout davranışı
 * bilinmemektedir (SPIKE-MCP-SDK-2026-001).
 *
 * Tool handler'ları bu arayüzün arkasında durur. Stable 2.x SDK seçildiğinde
 * yalnızca bu arayüzün SDK üzerine bir implementasyonu yazılır; handler'lar
 * değişmez.
 */

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** JSON-RPC 2.0 standart hata kodları. */
export const JSON_RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type RequestHandler = (request: JsonRpcRequest) => Promise<JsonRpcResponse | null>;

export interface TransportAdapter {
  /** Gelen istekleri işleyecek handler'ı bağlar ve dinlemeye başlar. */
  listen(handler: RequestHandler): void;
  /** Bağlantıyı kapatır; bekleyen işler iptal edilir. */
  close(): Promise<void>;
}
