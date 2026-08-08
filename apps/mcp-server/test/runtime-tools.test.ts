/**
 * CT-MCP-RUNTIME-001 — plugin_launch build_id köprüsü.
 *
 * plugin_launch mutlak path kabul etmez: hedef plugin yalnızca build_id
 * olarak iletilir; Supervisor artifacti build kaydından çözer (FS-03).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeTools } from '../src/tools/runtime.js';
import type { SupervisorClient } from '../src/supervisor-client.js';
import type { ToolDefinition, ToolHandler } from '../src/tools/facade.js';
import type { ToolProfileName } from '@mcpdev/generated-types';

type Ctx = { correlationId: string; profile: ToolProfileName };
type Tuple = [ToolDefinition, ToolHandler];

const CTX: Ctx = { correlationId: 'cor_test', profile: 'developer' };

function tupleHandler(tuples: Tuple[], name: string): Tuple {
  const found = tuples.find(([d]) => (d as { name: string })?.name === name);
  assert.ok(found, `tool bulunamadı: ${name}`);
  return found;
}

function makeFakeSupervisor(routes: Record<string, (params: unknown) => unknown>): SupervisorClient {
  return {
    call: async (method: string, params: never) => {
      const handler = routes[method];
      if (!handler) {
        throw Object.assign(new Error(`no route ${method}`), { code: 'SUPERVISOR_INTERNAL_ERROR' });
      }
      return handler(params);
    },
  } as unknown as SupervisorClient;
}

test('plugin_launch build_id verilirse runtime.create çağrısına taşır', async () => {
  const createParams: { params: { buildId?: string; acceptMinecraftEula: boolean } | null } = { params: null };
  const info = {
    supervisor: async () =>
      makeFakeSupervisor({
        'runtime.create': (params) => {
          createParams.params = params as { buildId?: string; acceptMinecraftEula: boolean };
          return { runtimeImageId: 'rimg_1', serverInstanceId: 'srv_1', state: 'CREATED' };
        },
        'runtime.launch': () => ({
          runtimeImageId: 'rimg_1',
          serverInstanceId: 'srv_1',
          state: 'READY',
          bridgeBootId: 'boot_1',
          bridgePort: 44575,
          readyGateMs: 42,
        }),
      }),
  };

  const [, fn] = tupleHandler(createRuntimeTools(info), 'plugin_launch');
  const r = await fn({ project_id: 'demo', build_id: 'run_abc', accept_eula: true }, CTX);

  assert.equal(r.status, 'success');
  assert.equal(createParams.params?.buildId, 'run_abc');
  assert.equal(createParams.params?.acceptMinecraftEula, true);
  assert.equal((r as { data?: { bridge_port?: number } }).data?.bridge_port, 44575);
});

test('plugin_launch build_id verilmezse runtime.create buildId taşımaz', async () => {
  const createParams: { params: { buildId?: string } | null } = { params: null };
  const info = {
    supervisor: async () =>
      makeFakeSupervisor({
        'runtime.create': (params) => {
          createParams.params = params as { buildId?: string };
          return { runtimeImageId: 'rimg_1', serverInstanceId: 'srv_1', state: 'CREATED' };
        },
        'runtime.launch': () => ({
          runtimeImageId: 'rimg_1',
          serverInstanceId: 'srv_1',
          state: 'READY',
          bridgeBootId: 'boot_1',
          bridgePort: 1,
          readyGateMs: 42,
        }),
      }),
  };

  const [, fn] = tupleHandler(createRuntimeTools(info), 'plugin_launch');
  const r = await fn({ project_id: 'demo' }, CTX);

  assert.equal(r.status, 'success');
  assert.equal(createParams.params?.buildId, undefined);
});

test('plugin_launch geçersiz build_id TOOL_INPUT_INVALID üretir', async () => {
  const info = { supervisor: async () => null };
  const [, fn] = tupleHandler(createRuntimeTools(info), 'plugin_launch');
  const r = await fn({ project_id: 'demo', build_id: 42 }, CTX);
  assert.equal(r.status, 'error');
  assert.equal((r as { error?: { code?: string } }).error?.code, 'TOOL_INPUT_INVALID');
});

test('plugin_launch Supervisor yoksa SUPERVISOR_UNAVAILABLE döner', async () => {
  const info = { supervisor: async (): Promise<SupervisorClient | null> => null };
  const [, fn] = tupleHandler(createRuntimeTools(info), 'plugin_launch');
  const r = await fn({ project_id: 'demo' }, CTX);
  assert.equal(r.status, 'error');
  assert.equal((r as { error?: { code?: string } }).error?.code, 'SUPERVISOR_UNAVAILABLE');
});

