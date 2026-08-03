/**
 * V1.1 tool'ları: pool_status, pool_acquire, pool_release, pool_evict, pool_list, pool_reset.
 *
 * Runtime pool yönetimi: runtimeları havuzda tutar, tekrar kullanımını sağlar.
 */

import { toolSuccess, toolError, type ToolDefinition, type ToolHandler } from './facade.js';
import type { SupervisorClient } from '../supervisor-client.js';
import type {
  PoolStatusResult,
  PoolAcquireResult,
  PoolReleaseResult,
  PoolEvictResult,
  PoolListResult,
  PoolResetResult,
} from '@mcpdev/contracts';

const TOOL_RESULT_SCHEMA_REF = {
  $ref: 'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json',
} as const;

export interface PoolToolsInfo {
  readonly supervisor: () => Promise<SupervisorClient | null>;
}

export function createPoolTools(info: PoolToolsInfo): Array<[ToolDefinition, ToolHandler]> {
  const poolStatus: [ToolDefinition, ToolHandler] = [
    {
      name: 'pool_status',
      title: 'Pool status',
      description: "Runtime pool durumunu döndürür: toplam, boşta, kullanımda, tahliye edilmiş ve süresi dolmuş runtime sayıları.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (_args, ctx) => {
      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<PoolStatusResult>('pool.status', {});
        return toolSuccess(ctx.correlationId, {
          total: result.total,
          idle: result.idle,
          acquired: result.acquired,
          evicted: result.evicted,
          expired: result.expired,
          max_pool_size: result.maxPoolSize,
          max_idle_ms: result.maxIdleMs,
          max_reuse_count: result.maxReuseCount,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'SUPERVISOR_INTERNAL_ERROR') as never, {
          message: error.message ?? String(err),
        });
      }
    },
  ];

  const poolAcquire: [ToolDefinition, ToolHandler] = [
    {
      name: 'pool_acquire',
      title: 'Pool acquire',
      description: "Runtime pool'dan bir runtime edinir. Boşta varsa onu yeniden kullanır, yoksa yeni bir havuz girişi oluşturur.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runtime_image_id: { type: 'string', description: 'Runtime Image kimliği' },
          runtime_id: { type: 'string', description: 'Runtime kimliği' },
          boot_id: { type: 'string', description: 'Boot kimliği' },
        },
        required: ['runtime_image_id', 'runtime_id', 'boot_id'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const runtimeImageId = args['runtime_image_id'];
      const runtimeId = args['runtime_id'];
      const bootId = args['boot_id'];

      if (typeof runtimeImageId !== 'string' || typeof runtimeId !== 'string' || typeof bootId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', {
          field: Object.entries({ runtimeImageId, runtimeId, bootId })
            .find(([, v]) => typeof v !== 'string')?.[0],
        });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<PoolAcquireResult>('pool.acquire', {
          runtimeImageId,
          runtimeId,
          bootId,
        });
        return toolSuccess(ctx.correlationId, {
          pool_id: result.poolId,
          reuse_count: result.reuseCount,
          reused: result.reused,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'SUPERVISOR_INTERNAL_ERROR') as never, {
          message: error.message ?? String(err),
        });
      }
    },
  ];

  const poolRelease: [ToolDefinition, ToolHandler] = [
    {
      name: 'pool_release',
      title: 'Pool release',
      description: "Havuzdaki bir runtime'ı serbest bırakır. Yeniden kullanım sayısı sınırı aşıldıysa tahliye eder.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pool_id: { type: 'string', description: 'Havuz girişi kimliği' },
        },
        required: ['pool_id'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const poolId = args['pool_id'];
      if (typeof poolId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'pool_id' });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<PoolReleaseResult>('pool.release', { poolId });
        return toolSuccess(ctx.correlationId, {
          pool_id: poolId,
          state: result.state,
          evicted: result.evicted,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'SUPERVISOR_INTERNAL_ERROR') as never, {
          pool_id: poolId,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  const poolEvict: [ToolDefinition, ToolHandler] = [
    {
      name: 'pool_evict',
      title: 'Pool evict',
      description: "Havuzdaki bir runtime'ı zorla tahliye eder.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pool_id: { type: 'string', description: 'Havuz girişi kimliği' },
        },
        required: ['pool_id'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const poolId = args['pool_id'];
      if (typeof poolId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'pool_id' });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<PoolEvictResult>('pool.evict', { poolId });
        return toolSuccess(ctx.correlationId, {
          pool_id: poolId,
          evicted: result.evicted,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'SUPERVISOR_INTERNAL_ERROR') as never, {
          pool_id: poolId,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  const poolList: [ToolDefinition, ToolHandler] = [
    {
      name: 'pool_list',
      title: 'Pool list',
      description: "Havuzdaki runtime'ların listesini döndürür.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runtime_image_id: { type: 'string', description: 'Runtime Image kimliğine göre filtrele (opsiyonel)' },
        },
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const runtimeImageId = args['runtime_image_id'];

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<PoolListResult>('pool.list', {
          ...(typeof runtimeImageId === 'string' ? { runtimeImageId } : {}),
        });
        return toolSuccess(ctx.correlationId, {
          entries: result.entries.map(e => ({
            pool_id: e.poolId,
            runtime_image_id: e.runtimeImageId,
            runtime_id: e.runtimeId,
            boot_id: e.bootId,
            state: e.state,
            reuse_count: e.reuseCount,
            acquired_at: e.acquiredAt,
            last_activity_at: e.lastActivityAt,
            created_at: e.createdAt,
          })),
          total: result.total,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'SUPERVISOR_INTERNAL_ERROR') as never, {
          message: error.message ?? String(err),
        });
      }
    },
  ];

  const poolReset: [ToolDefinition, ToolHandler] = [
    {
      name: 'pool_reset',
      title: 'Pool reset',
      description: "Havuzdaki tüm runtime'ları temizler.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (_args, ctx) => {
      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<PoolResetResult>('pool.reset', {});
        return toolSuccess(ctx.correlationId, {
          evicted: result.evicted,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'SUPERVISOR_INTERNAL_ERROR') as never, {
          message: error.message ?? String(err),
        });
      }
    },
  ];

  return [poolStatus, poolAcquire, poolRelease, poolEvict, poolList, poolReset];
}