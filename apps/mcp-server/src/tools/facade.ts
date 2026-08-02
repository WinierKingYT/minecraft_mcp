/**
 * Stable Tool Facade — docs/contracts/mcp.md TL-01..TL-05.
 *
 *   TL-01 Tool listesi başlangıç profiline göre belirlenir
 *   TL-02 Runtime capability durumuna göre araçlar KAYBOLMAZ
 *   TL-03 Eksik capability -> CAPABILITY_UNAVAILABLE
 *   TL-04 Aynı profilde tool sırası deterministiktir
 *   TL-05 Tool list change notification yalnızca açık profil/config değişiminde
 */

import { randomUUID } from 'node:crypto';
import type { ToolStructuredContent, ToolError, TerminalRunState } from '@mcpdev/contracts';
import { CAPABILITIES, TOOL_TO_CAPABILITY } from '@mcpdev/generated-types';
import { ERRORS, type ErrorCode } from '@mcpdev/generated-types';
import { TOOL_PROFILES, type ToolProfileName } from '@mcpdev/generated-types';

export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  readonly resultType: 'complete';
  readonly isError: boolean;
  readonly content: ReadonlyArray<{ type: 'text'; text: string }>;
  readonly structuredContent: ToolStructuredContent;
}

export type ToolHandler = (
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
) => Promise<ToolStructuredContent>;

export interface ToolContext {
  readonly correlationId: string;
  readonly profile: ToolProfileName;
}

export function newCorrelationId(): string {
  return `cor_${randomUUID().replace(/-/g, '')}`;
}

/** Domain hatası üretir. Kod catalog'da tanımlı olmalıdır. */
export function toolError(correlationId: string, code: ErrorCode, details?: Record<string, unknown>): ToolStructuredContent {
  const meta = ERRORS[code];
  const error: ToolError = {
    code,
    retryable: meta.retryable,
    suggested_action: meta.suggestedAction,
    ...(details ? { details } : {}),
    // exactOptionalPropertyTypes: alan ya doğru tiple var ya da hiç yok.
    ...(meta.terminalState ? { terminal_state: meta.terminalState as TerminalRunState } : {}),
  };
  return { status: 'error', correlation_id: correlationId, error };
}

export function toolSuccess<T>(
  correlationId: string,
  data: T,
  warnings: readonly string[] = [],
): ToolStructuredContent<T> {
  return { status: 'success', correlation_id: correlationId, data, warnings };
}

/** structuredContent -> MCP tool sonucu. */
export function toCallResult(structured: ToolStructuredContent, text: string): ToolCallResult {
  return {
    resultType: 'complete',
    isError: structured.status === 'error',
    content: [{ type: 'text', text }],
    structuredContent: structured,
  };
}

export class ToolFacade {
  readonly #profile: ToolProfileName;
  readonly #handlers = new Map<string, ToolHandler>();
  readonly #definitions = new Map<string, ToolDefinition>();

  constructor(profile: ToolProfileName) {
    this.#profile = profile;
  }

  get profile(): ToolProfileName {
    return this.#profile;
  }

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.#definitions.set(definition.name, definition);
    this.#handlers.set(definition.name, handler);
  }

  /**
   * TL-01 + TL-04: liste profilden gelir ve sırası profiles.yaml'daki sıradır.
   * TL-02: henüz uygulanmamış bir tool listeden DÜŞMEZ; çağrıldığında
   * CAPABILITY_UNAVAILABLE döner.
   */
  listTools(): readonly ToolDefinition[] {
    return TOOL_PROFILES[this.#profile].map((name) => this.#definitions.get(name) ?? placeholderDefinition(name));
  }

  has(name: string): boolean {
    return (TOOL_PROFILES[this.#profile] as readonly string[]).includes(name);
  }

  async call(name: string, args: Readonly<Record<string, unknown>>): Promise<ToolCallResult> {
    const correlationId = newCorrelationId();
    const handler = this.#handlers.get(name);

    if (!handler) {
      // TL-03: tool profilde var ama capability bu build'de yok.
      const structured = toolError(correlationId, 'CAPABILITY_UNAVAILABLE', { tool: name });
      return toCallResult(structured, `"${name}" bu kurulumda henüz kullanılamıyor.`);
    }

    const structured = await handler(args, { correlationId, profile: this.#profile });
    const text =
      structured.status === 'error'
        ? ERRORS[structured.error.code as ErrorCode]?.message ?? 'İşlem başarısız.'
        : 'İşlem tamamlandı.';
    return toCallResult(structured, text);
  }
}

/**
 * Henüz uygulanmamış tool'lar için minimum geçerli tanım.
 *
 * TL-02 gereği bu tool listeden düşmez; açıklaması capability kaydından gelir,
 * çağrıldığında CAPABILITY_UNAVAILABLE döner. Böylece ajan neyin var olduğunu
 * ve neden çalışmadığını ayrı ayrı görebilir.
 */
function placeholderDefinition(name: string): ToolDefinition {
  const capabilityId = TOOL_TO_CAPABILITY[name];
  const capability = capabilityId ? CAPABILITIES[capabilityId] : undefined;

  return {
    name,
    title: name,
    description: capability
      ? `${capability.summary} (bu kurulumda henüz uygulanmadı — milestone ${capability.milestone})`
      : 'Bu tool profilde tanımlıdır fakat bu kurulumda henüz uygulanmamıştır.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    outputSchema: { $ref: 'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json' },
  };
}
