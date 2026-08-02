/**
 * M1 tool'u: evidence_get.
 *
 * Kanıt nesnelerini ve birleşik raporu redaction ve byte limiti uygulayarak döndürür.
 */

import { toolSuccess, toolError, type ToolDefinition, type ToolHandler } from './facade.js';
import type { SupervisorClient } from '../supervisor-client.js';
import type { EvidenceGetResult } from '@mcpdev/contracts';

const TOOL_RESULT_SCHEMA_REF = {
  $ref: 'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json',
} as const;

const MAX_EVIDENCE_BYTES = 512_000;

export interface EvidenceToolsInfo {
  readonly supervisor: () => Promise<SupervisorClient | null>;
}

export function createEvidenceTools(info: EvidenceToolsInfo): Array<[ToolDefinition, ToolHandler]> {
  const evidenceGet: [ToolDefinition, ToolHandler] = [
    {
      name: 'evidence_get',
      title: 'Evidence get',
      description: "Kanıt nesnelerini ve birleşik raporu redaction ve byte limiti uygulayarak döndürür.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          evidence_id: { type: 'string', description: 'Kanıt kimliği' },
          run_id: { type: 'string', description: 'Run kimliği (opsiyonel)' },
        },
        required: ['evidence_id'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const evidenceId = args['evidence_id'];

      if (typeof evidenceId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'evidence_id' });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<EvidenceGetResult>('evidence.get', {
          evidenceId,
          ...(typeof args['run_id'] === 'string' ? { runId: args['run_id'] } : {}),
        });

        if (result.byteSize > MAX_EVIDENCE_BYTES) {
          return toolError(ctx.correlationId, 'OUTPUT_LIMIT_EXCEEDED', {
            evidence_id: evidenceId,
            byte_size: result.byteSize,
            limit: MAX_EVIDENCE_BYTES,
          });
        }

        return toolSuccess(ctx.correlationId, {
          evidence_id: result.evidenceId,
          kind: result.kind,
          producer: result.producer,
          content: result.content,
          byte_size: result.byteSize,
          checksum: result.checksum,
          created_at: result.createdAt,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'EVIDENCE_NOT_FOUND') as never, {
          evidence_id: evidenceId,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  return [evidenceGet];
}
