/**
 * M1 tool'ları: plugin_launch ve plugin_stop.
 *
 * Runtime lifecycle'ını MCP üzerinden yönetir: oluşturma, başlatma,
 * durdurma ve serbest bırakma. Mevcut IPC method'larını kullanır.
 */

import { IPC_LAUNCH_TIMEOUT_MS } from '@mcpdev/contracts';
import { toolSuccess, toolError, type ToolDefinition, type ToolHandler } from './facade.js';
import type { SupervisorClient } from '../supervisor-client.js';

const TOOL_RESULT_SCHEMA_REF = {
  $ref: 'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json',
} as const;

export interface RuntimeToolsInfo {
  readonly supervisor: () => Promise<SupervisorClient | null>;
}

export function createRuntimeTools(info: RuntimeToolsInfo): Array<[ToolDefinition, ToolHandler]> {
  const pluginLaunch: [ToolDefinition, ToolHandler] = [
    {
      name: 'plugin_launch',
      title: 'Plugin launch',
      description: "Paper process'ini başlatır, Bridge handshake'ini bekler ve ready gate'i doğrular. build_id verilirse o build'in ürettiği plugin JAR'ı runtime'a kurulur.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project_id: { type: 'string', description: 'Proje kimliği' },
          build_id: {
            type: 'string',
            description: 'plugin_build sonucundaki build kimliği; bu buildin artifacti hedef plugin olarak kurulur',
          },
        },
        required: ['project_id'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const projectId = args['project_id'];
      const buildId = args['build_id'];

      if (typeof projectId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'project_id' });
      }
      if (buildId !== undefined && typeof buildId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'build_id' });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        // Step 1: Runtime oluştur
        const createResult = await client.call<{
          runtimeImageId: string;
          serverInstanceId: string;
          state: string;
        }>('runtime.create', {
          ...(buildId ? { buildId } : {}),
        });

        // Step 2: Runtime'ı başlat
        const launchResult = await client.call<{
          runtimeImageId: string;
          serverInstanceId: string;
          state: string;
          bridgeBootId: string | null;
          bridgePort: number | null;
          readyGateMs: number | null;
        }>(
          'runtime.launch',
          { runtimeImageId: createResult.runtimeImageId },
          IPC_LAUNCH_TIMEOUT_MS,
        );

        return toolSuccess(ctx.correlationId, {
          runtime_id: launchResult.runtimeImageId,
          server_instance_id: launchResult.serverInstanceId,
          state: launchResult.state,
          bridge_boot_id: launchResult.bridgeBootId,
          bridge_port: launchResult.bridgePort,
          ready_gate_ms: launchResult.readyGateMs,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'RUNTIME_CRASHED') as never, {
          project_id: projectId,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  const pluginStop: [ToolDefinition, ToolHandler] = [
    {
      name: 'plugin_stop',
      title: 'Plugin stop',
      description: "Paper'ı graceful biçimde kapatır; timeout aşılırsa force termination uygular.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runtime_id: { type: 'string', description: 'Runtime kimliği' },
        },
        required: ['runtime_id'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const runtimeId = args['runtime_id'];

      if (typeof runtimeId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'runtime_id' });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<{
          graceful: boolean;
          forceTerminated: boolean;
          exitCode: number | null;
          portReleased: boolean;
          handshakeRemoved: boolean;
          durationMs: number;
        }>('runtime.stop', { runtimeImageId: runtimeId });

        return toolSuccess(ctx.correlationId, {
          runtime_id: runtimeId,
          graceful: result.graceful,
          force_terminated: result.forceTerminated,
          exit_code: result.exitCode,
          port_released: result.portReleased,
          handshake_removed: result.handshakeRemoved,
          duration_ms: result.durationMs,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'RUNTIME_NOT_FOUND') as never, {
          runtime_id: runtimeId,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  return [pluginLaunch, pluginStop];
}
