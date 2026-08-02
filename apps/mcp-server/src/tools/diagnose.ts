/**
 * M1 tool'u: plugin_diagnose.
 *
 * Başarısız bir build veya startup için yapılandırılmış teşhis ve
 * önerilen aksiyon üretir.
 */

import { toolSuccess, toolError, type ToolDefinition, type ToolHandler } from './facade.js';
import type { SupervisorClient } from '../supervisor-client.js';
import type { PluginDiagnoseResult } from '@mcpdev/contracts';

const TOOL_RESULT_SCHEMA_REF = {
  $ref: 'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json',
} as const;

export interface DiagnoseToolsInfo {
  readonly supervisor: () => Promise<SupervisorClient | null>;
}

export function createDiagnoseTools(info: DiagnoseToolsInfo): Array<[ToolDefinition, ToolHandler]> {
  const pluginDiagnose: [ToolDefinition, ToolHandler] = [
    {
      name: 'plugin_diagnose',
      title: 'Plugin diagnose',
      description: "Başarısız bir build veya startup için yapılandırılmış teşhis ve önerilen aksiyon üretir.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runtime_id: { type: 'string', description: 'Runtime kimliği (runtime hataları için)' },
          build_id: { type: 'string', description: 'Build kimliği (build hataları için)' },
        },
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const runtimeId = args['runtime_id'];
      const buildId = args['build_id'];

      if (typeof runtimeId !== 'string' && typeof buildId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', {
          message: 'runtime_id veya build_id alanlarından biri gerekli.',
        });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<PluginDiagnoseResult>('plugin.diagnose', {
          ...(typeof runtimeId === 'string' ? { runtimeId } : {}),
          ...(typeof buildId === 'string' ? { buildId } : {}),
        });

        return toolSuccess(ctx.correlationId, {
          type: result.type,
          summary: result.summary,
          errors: result.errors,
          failed_tasks: result.failedTasks,
          warnings: result.warnings,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'EVIDENCE_NOT_FOUND') as never, {
          runtime_id: runtimeId,
          build_id: buildId,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  return [pluginDiagnose];
}
