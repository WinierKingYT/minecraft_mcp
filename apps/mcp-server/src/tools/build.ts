/**
 * M1 tool'u: plugin_build.
 *
 * Build pipeline'ını MCP üzerinden tetikler; source snapshot, supply-chain
 * validation, build ve artifact selection adımlarını çalıştırır.
 */

import { IPC_LAUNCH_TIMEOUT_MS } from '@mcpdev/contracts';
import { toolSuccess, toolError, type ToolDefinition, type ToolHandler } from './facade.js';
import type { SupervisorClient } from '../supervisor-client.js';
import type { BuildRunResult } from '@mcpdev/contracts';

const TOOL_RESULT_SCHEMA_REF = {
  $ref: 'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json',
} as const;

export interface BuildToolsInfo {
  readonly supervisor: () => Promise<SupervisorClient | null>;
}

export function createBuildTools(info: BuildToolsInfo): Array<[ToolDefinition, ToolHandler]> {
  const pluginBuild: [ToolDefinition, ToolHandler] = [
    {
      name: 'plugin_build',
      title: 'Plugin build',
      description: "Source snapshot'ı izin verilen execution backend içinde, enum tabanlı bir build moduyla derler.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project_id: { type: 'string', description: 'Proje kimliği' },
          mode: {
            type: 'string',
            enum: ['build', 'unit_test', 'integration_test', 'clean_build'],
            description: 'Build modu',
          },
          network: {
            type: 'string',
            enum: ['online', 'offline'],
            description: 'Ağ erişim modu (varsayılan: offline)',
          },
          timeout_seconds: {
            type: 'number',
            description: 'Build üst süresi saniye cinsinden (varsayılan: 120)',
          },
        },
        required: ['project_id', 'mode'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const projectId = args['project_id'];
      const mode = args['mode'];
      const network = (args['network'] as string) ?? 'offline';
      const timeoutSeconds = (args['timeout_seconds'] as number) ?? 120;

      if (typeof projectId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'project_id' });
      }
      if (typeof mode !== 'string' || !['build', 'unit_test', 'integration_test', 'clean_build'].includes(mode)) {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'mode' });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<BuildRunResult>(
          'build.run',
          {
            projectId,
            mode,
            network: network as 'online' | 'offline',
            timeoutMs: timeoutSeconds * 1000,
          },
          IPC_LAUNCH_TIMEOUT_MS,
        );

        if (result.status === 'failed') {
          return toolError(ctx.correlationId, 'BUILD_FAILED', {
            build_id: result.buildId,
            diagnostics: result.diagnostics,
            duration_ms: result.durationMs,
          });
        }

        return toolSuccess(ctx.correlationId, {
          build_id: result.buildId,
          project_id: result.projectId,
          mode: result.mode,
          status: result.status,
          artifact: result.artifact,
          duration_ms: result.durationMs,
          evidence_ids: result.evidenceIds,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'BUILD_FAILED') as never, {
          project_id: projectId,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  return [pluginBuild];
}
