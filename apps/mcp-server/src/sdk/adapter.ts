/**
 * Official MCP SDK adapter — ADR-0008, SPIKE-MCP-SDK-2026-001 closure.
 *
 * Protokol yüzeyi (server/discover, cache hint'leri, era negotiation, legacy
 * shim) @modelcontextprotocol/server@2.0.0 tarafından yönetilir. ToolFacade
 * domain katmanı bu dosyada SDK'ya bağlanır; facade tool tanımları SDK
 * şemasına (Standard Schema) çevrilir.
 *
 * Şema köprüsü bilinçli olarak passthrough'tur: facade şemaları birebir
 * tools/list'te yayınlanır (TL-01/CT-MCP-TOOLLIST-001) ve args doğrulaması
 * handler katmanında TOOL_INPUT_INVALID akışıyla yapılır. Tek istisna
 * outputSchema'dır: common/tool-result şemasına $ref veren şemalar, SDK
 * client'ının client-side output validator'ında çözülemez (AJV remote $ref
 * yüklemez) — bu yüzden output şemaları $defs-gömülü, self-contained hale
 * getirilir.
 */

import { McpServer } from '@modelcontextprotocol/server';
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { ToolFacade } from '../tools/facade.js';
import { log } from '../logging.js';

export interface SdkServerOptions {
  readonly name: string;
  readonly version: string;
  readonly facade: ToolFacade;
  readonly toolListTtlMs: number;
}

export const TOOL_RESULT_SCHEMA_URI =
  'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json';

/**
 * packages/contracts/schemas/common/tool-result.schema.json + tool-error
 * şemasının `$defs`-gömülü kopyası. Sürüklenmeyi önlemek için dosyalarla
 * birebir senkron tutulur (CONTEXT: contracts şema dizini).
 */
const TOOL_ERROR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'retryable', 'suggested_action'],
  properties: {
    code: {
      type: 'string',
      pattern: '^[A-Z][A-Z0-9_]*$',
      description: "Error catalog'da tanımlı bir kod.",
    },
    retryable: { type: 'boolean' },
    suggested_action: {
      type: 'string',
      minLength: 8,
      description: 'KPI-08: her hata önerilen aksiyon taşır.',
    },
    details: {
      type: 'object',
      description:
        'Redaction profilinden geçmiş yapılandırılmış ayrıntı. Raw host path veya secret içermez.',
    },
    terminal_state: {
      enum: ['FAILED', 'CANCELLED', 'TIMED_OUT', 'DIRTY', 'ORPHANED', 'UNKNOWN_OUTCOME'],
    },
  },
};

const TOOL_RESULT_SCHEMA: Record<string, unknown> = {
  title: 'Tool structuredContent',
  description: 'Her tool un structuredContent alanı bu success/error union ına uymak zorundadır.',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'correlation_id', 'data', 'warnings'],
      properties: {
        status: { const: 'success' },
        correlation_id: { type: 'string', minLength: 1 },
        data: {},
        warnings: { type: 'array', items: { type: 'string' } },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'correlation_id', 'error'],
      properties: {
        status: { const: 'error' },
        correlation_id: { type: 'string', minLength: 1 },
        error: { $ref: '#/$defs/tool-error.schema.json' },
      },
    },
  ],
};

/** Ortak tool-result şemasının self-contained (client-side compile edilebilir) hali. */
export function buildToolResultOutputSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: {
      'tool-result.schema.json': TOOL_RESULT_SCHEMA,
      'tool-error.schema.json': TOOL_ERROR_SCHEMA,
    },
    $ref: '#/$defs/tool-result.schema.json',
  };
}

/**
 * Facade output şemasını client'ın çözebileceği şekle getirir.
 * $ref-only ortak şema -> gömülü kopya; diğer şemalar birebir.
 */
export function resolveOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (
    typeof schema['$ref'] === 'string' &&
    (schema['$ref'] === TOOL_RESULT_SCHEMA_URI || schema['$ref'].startsWith(`${TOOL_RESULT_SCHEMA_URI}#`))
  ) {
    return buildToolResultOutputSchema();
  }
  return schema;
}

/**
 * JSON Schema -> Standard Schema passthrough köprüsü.
 *
 * validate: her değeri kabul eder (handler kendi doğrulamasını yapar).
 * jsonSchema: orijinal facade şemasını birebir döndürür.
 */
export function jsonSchemaToStandardSchema(schema: Record<string, unknown>): StandardSchemaWithJSON {
  return {
    '~standard': {
      version: 1,
      vendor: 'minecraft-plugin-dev-mcp',
      validate: (value: unknown) => ({ value }),
      jsonSchema: {
        input: () => schema,
        output: () => schema,
      },
    },
  };
}

/**
 * Facade -> SDK McpServer köprüsü. Her bağlantıda çağrılır; dönen örnek yalnız
 * o bağlantıya aittir (stateless, ADR-0008).
 */
export function buildSdkServer(opts: SdkServerOptions): McpServer {
  const server = new McpServer(
    { name: opts.name, version: opts.version },
    {
      capabilities: { tools: {} },
      cacheHints: {
        'tools/list': { ttlMs: opts.toolListTtlMs, cacheScope: 'private' },
        'server/discover': { ttlMs: opts.toolListTtlMs, cacheScope: 'private' },
      },
    },
  );

  let registered = 0;
  for (const tool of opts.facade.listTools()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: jsonSchemaToStandardSchema(tool.inputSchema),
        outputSchema: jsonSchemaToStandardSchema(resolveOutputSchema(tool.outputSchema)),
      },
      async (args) => {
        const result = await opts.facade.call(
          tool.name,
          (args ?? {}) as Readonly<Record<string, unknown>>,
        );
        return {
          resultType: 'complete',
          content: [...result.content],
          structuredContent: result.structuredContent,
          ...(result.isError ? { isError: true } : {}),
        };
      },
    );
    registered += 1;
  }

  log('INFO', 'server.started', {
    name: opts.name,
    version: opts.version,
    tool_profile: opts.facade.profile,
    tools: registered,
  });

  return server;
}
