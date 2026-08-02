/**
 * M0 tool'ları: operation_get ve operation_cancel.
 *
 * Uzun süren operation'ların durumunu sorgular ve iptal eder.
 * Mevcut IPC method'larını kullanır: runtime.get, runtime.stop, runtime.release.
 */

import { toolSuccess, toolError, type ToolDefinition, type ToolHandler } from './facade.js';
import type { SupervisorClient } from '../supervisor-client.js';

const TOOL_RESULT_SCHEMA_REF = {
  $ref: 'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json',
} as const;

export interface OperationToolsInfo {
  readonly supervisor: () => Promise<SupervisorClient | null>;
}

export function createOperationTools(info: OperationToolsInfo): Array<[ToolDefinition, ToolHandler]> {
  const operationGet: [ToolDefinition, ToolHandler] = [
    {
      name: 'operation_get',
      title: 'Operation get',
      description: "Uzun süren bir operation'ın durumunu, ilerlemesini ve sonucunu döndürür.",
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
          runtimeImageId: string;
          serverInstanceId: string;
          state: string;
          bridgeBootId: string | null;
          bridgePort: number | null;
          createdAt: string;
          readyGateMs: number | null;
        }>('runtime.get', { runtimeImageId: runtimeId });

        return toolSuccess(ctx.correlationId, {
          runtime_id: result.runtimeImageId,
          server_instance_id: result.serverInstanceId,
          state: result.state,
          bridge_boot_id: result.bridgeBootId,
          bridge_port: result.bridgePort,
          created_at: result.createdAt,
          ready_gate_ms: result.readyGateMs,
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

  const operationCancel: [ToolDefinition, ToolHandler] = [
    {
      name: 'operation_cancel',
      title: 'Operation cancel',
      description: "Çalışan bir operation'ın iptalini talep eder; iptal kooperatiftir ve terminal durum ayrı raporlanır.",
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
        // Önce runtime'ı durdur
        const stopResult = await client.call<{
          graceful: boolean;
          forceTerminated: boolean;
          exitCode: number | null;
          durationMs: number;
        }>('runtime.stop', { runtimeImageId: runtimeId });

        // Sonra serbest bırak
        await client.call<{ state: string }>('runtime.release', {
          runtimeImageId: runtimeId,
          discardImmediately: false,
        });

        return toolSuccess(ctx.correlationId, {
          runtime_id: runtimeId,
          cancelled: true,
          graceful: stopResult.graceful,
          force_terminated: stopResult.forceTerminated,
          exit_code: stopResult.exitCode,
          duration_ms: stopResult.durationMs,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        if (error.code === 'RUNTIME_INVALID_STATE') {
          return toolError(ctx.correlationId, 'OPERATION_NOT_CANCELLABLE', { runtime_id: runtimeId });
        }
        return toolError(ctx.correlationId, (error.code ?? 'OPERATION_NOT_FOUND') as never, {
          runtime_id: runtimeId,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  return [operationGet, operationCancel];
}
