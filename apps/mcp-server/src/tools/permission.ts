/**
 * V1.1 tool'ları: permission_attach, permission_detach, permission_check, permission_list.
 *
 * Test actor'larına geçici izin atamak için kullanılır. Native Paper ve LuckPerms
 * adapter üzerinden çalışır.
 */

import { toolSuccess, toolError, type ToolDefinition, type ToolHandler } from './facade.js';
import type { SupervisorClient } from '../supervisor-client.js';

const TOOL_RESULT_SCHEMA_REF = {
  $ref: 'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json',
} as const;

export interface PermissionToolsInfo {
  readonly supervisor: () => Promise<SupervisorClient | null>;
}

export function createPermissionTools(info: PermissionToolsInfo): Array<[ToolDefinition, ToolHandler]> {
  const permissionAttach: [ToolDefinition, ToolHandler] = [
    {
      name: 'permission_attach',
      title: 'Permission attach',
      description: "Test actor'una geçici bir izin atar. Provider 'native' (Paper) veya 'luckperms' olabilir.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          player: { type: 'string', description: 'Oyuncu adı' },
          permission: { type: 'string', description: 'İzin dizesi (örn: complexplugin.admin)' },
          value: { type: 'boolean', description: 'true = izin ver, false = reddet', default: true },
          duration_ms: { type: 'number', description: 'İzin süresi (ms, opsiyonel)' },
        },
        required: ['player', 'permission'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const player = args['player'];
      const permission = args['permission'];
      const value = args['value'] as boolean | undefined;
      const durationMs = args['duration_ms'] as number | undefined;

      if (typeof player !== 'string' || typeof permission !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', {
          field: typeof player !== 'string' ? 'player' : 'permission',
        });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<{
          attachmentId: string;
          playerName: string;
          permission: string;
          value: boolean;
          createdAt: number;
          expiresAt: number | null;
        }>('permission.attach', { player, permission, value, durationMs });

        return toolSuccess(ctx.correlationId, {
          attachment_id: result.attachmentId,
          player: result.playerName,
          permission: result.permission,
          value: result.value,
          created_at: result.createdAt,
          expires_at: result.expiresAt,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'PERMISSION_PROVIDER_UNSUPPORTED') as never, {
          player,
          permission,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  const permissionDetach: [ToolDefinition, ToolHandler] = [
    {
      name: 'permission_detach',
      title: 'Permission detach',
      description: "Test actor'undan daha önce atanmış bir izni kaldırır.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          attachment_id: { type: 'string', description: 'İzin attachment kimliği' },
        },
        required: ['attachment_id'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const attachmentId = args['attachment_id'];
      if (typeof attachmentId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'attachment_id' });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        await client.call<{ success: boolean }>('permission.detach', { attachmentId });
        return toolSuccess(ctx.correlationId, {
          attachment_id: attachmentId,
          detached: true,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'PERMISSION_PROVIDER_UNSUPPORTED') as never, {
          attachment_id: attachmentId,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  const permissionCheck: [ToolDefinition, ToolHandler] = [
    {
      name: 'permission_check',
      title: 'Permission check',
      description: "Test actor'unun belirtilen izne sahip olup olmadığını kontrol eder.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          player: { type: 'string', description: 'Oyuncu adı' },
          permission: { type: 'string', description: 'İzin dizesi' },
        },
        required: ['player', 'permission'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const player = args['player'];
      const permission = args['permission'];

      if (typeof player !== 'string' || typeof permission !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', {
          field: typeof player !== 'string' ? 'player' : 'permission',
        });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<{
          player: string;
          permission: string;
          hasPermission: boolean;
          source: string;
        }>('permission.check', { player, permission });

        return toolSuccess(ctx.correlationId, {
          player: result.player,
          permission: result.permission,
          has_permission: result.hasPermission,
          source: result.source,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'PERMISSION_PROVIDER_UNSUPPORTED') as never, {
          player,
          permission,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  const permissionSetOp: [ToolDefinition, ToolHandler] = [
    {
      name: 'permission_set_op',
      title: 'Permission set op',
      description: "Test actor'una operatör statüsü atar veya kaldırır.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          player: { type: 'string', description: 'Oyuncu adı' },
          value: { type: 'boolean', description: 'true = op ver, false = op kaldır' },
        },
        required: ['player', 'value'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const player = args['player'];
      const value = args['value'];

      if (typeof player !== 'string' || typeof value !== 'boolean') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', {
          field: typeof player !== 'string' ? 'player' : 'value',
        });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        await client.call<{ success: boolean }>('permission.set_op', { player, value });
        return toolSuccess(ctx.correlationId, {
          player,
          op: value,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'PERMISSION_PROVIDER_UNSUPPORTED') as never, {
          player,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  return [permissionAttach, permissionDetach, permissionCheck, permissionSetOp];
}