/**
 * CT-MCP-V11-001 — V1.1 tool hatları için birim testleri.
 *
 * createPoolTools / createProfileTools / createPermissionTools handler'larını
 * mock SupervisorClient ile çağırarak doğrular:
 *   - başarı yolu: doğru IPC method adı ve yanıt eşlemesi
 *   - hata yolu: SUPERVISOR_UNAVAILABLE (Supervisor yok)
 *   - giriş doğrulama: TOOL_INPUT_INVALID
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoolTools } from '../src/tools/pool.js';
import { createProfileTools } from '../src/tools/profile.js';
import { createPermissionTools } from '../src/tools/permission.js';
import { createScenarioTools } from '../src/tools/scenario.js';
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

const noRoutes = makeFakeSupervisor({});

test('pool_status, Supervisor varken yanıt döner', async () => {
  const info = {
    supervisor: async () => makeFakeSupervisor({
      'pool.status': () => ({ total: 5, idle: 2, acquired: 3, evicted: 1, expired: 0, maxPoolSize: 8, maxIdleMs: 60000, maxReuseCount: 10 }),
    }),
  };
  const [, fn] = tupleHandler(createPoolTools(info), 'pool_status');
  const r = await fn({}, CTX);
  assert.equal(r.status, 'success');
});

test('pool_status, Supervisor yoksa SUPERVISOR_UNAVAILABLE döner', async () => {
  const [, fn] = tupleHandler(createPoolTools({
    supervisor: async (): Promise<SupervisorClient | null> => null,
  }), 'pool_status');
  const r = await fn({}, CTX);
  assert.equal(r.status, 'error');
  assert.equal(r.error?.code, 'SUPERVISOR_UNAVAILABLE');
});

test("pool_status, Supervisor'dan hata gelirse yayılır", async () => {
  const [, fn] = tupleHandler(createPoolTools({
    supervisor: async () => makeFakeSupervisor({
      'pool.status': () => {
        throw Object.assign(new Error('pool kapalı'), { code: 'SUPERVISOR_UNAVAILABLE' });
      },
    }),
  }), 'pool_status');
  const r = await fn({}, CTX);
  assert.equal(r.status, 'error');
  assert.equal(r.error?.code, 'SUPERVISOR_UNAVAILABLE');
});

test('pool_acquire geçersiz giriş TOOL_INPUT_INVALID döner', async () => {
  const [, fn] = tupleHandler(createPoolTools({ supervisor: async () => noRoutes }), 'pool_acquire');
  const r = await fn({ runtime_image_id: 123 }, CTX);
  assert.equal(r.status, 'error');
  assert.equal(r.error?.code, 'TOOL_INPUT_INVALID');
});

test('pool_acquire başarı yolu doğru IPC method adını kullanır', async () => {
  let called = false;
  const info = {
    supervisor: async () => makeFakeSupervisor({
      'pool.acquire': () => { called = true; return { poolId: 'p-1', reuseCount: 2, reused: true }; },
    }),
  };
  const [, fn] = tupleHandler(createPoolTools(info), 'pool_acquire');
  const r = await fn({ runtime_image_id: 'img', runtime_id: 'rt', boot_id: 'b' }, CTX);
  assert.equal(r.status, 'success');
  assert.equal(called, true);
});

test('pool_list, Supervisor yoksa SUPERVISOR_UNAVAILABLE döner', async () => {
  const [, fn] = tupleHandler(createPoolTools({ supervisor: async () => null }), 'pool_list');
  const r = await fn({}, CTX);
  assert.equal(r.status, 'error');
  assert.equal(r.error?.code, 'SUPERVISOR_UNAVAILABLE');
});

test('permission_check geçersiz giriş TOOL_INPUT_INVALID döner', async () => {
  const [, fn] = tupleHandler(createPermissionTools({ supervisor: async () => noRoutes }), 'permission_check');
  const r = await fn({ player: 'Steve' }, CTX);
  assert.equal(r.status, 'error');
  assert.equal(r.error?.code, 'TOOL_INPUT_INVALID');
});

test('permission_attach başarı yolu doğru IPC method adını kullanır', async () => {
  let called = false;
  const info = {
    supervisor: async () => makeFakeSupervisor({
      'permission.attach': () => { called = true; return { attachmentId: 'att-1', playerName: 'Steve', permission: 'mod.admin', value: true, createdAt: 1, expiresAt: null }; },
    }),
  };
  const [, fn] = tupleHandler(createPermissionTools(info), 'permission_attach');
  const r = await fn({ player: 'Steve', permission: 'mod.admin' }, CTX);
  assert.equal(r.status, 'success');
  assert.equal(called, true);
});

test('permission_set_op, boolean olmayan value TOOL_INPUT_INVALID döner', async () => {
  const [, fn] = tupleHandler(createPermissionTools({ supervisor: async () => noRoutes }), 'permission_set_op');
  const r = await fn({ player: 'Steve', value: 'yes' }, CTX);
  assert.equal(r.status, 'error');
  assert.equal(r.error?.code, 'TOOL_INPUT_INVALID');
});

test('permission_check, provider hatası PERMISSION_PROVIDER_UNSUPPORTED yayılır', async () => {
  const [, fn] = tupleHandler(createPermissionTools({
    supervisor: async () => makeFakeSupervisor({
      'permission.check': () => {
        throw Object.assign(new Error('no provider'), { code: 'PERMISSION_PROVIDER_UNSUPPORTED' });
      },
    }),
  }), 'permission_check');
  const r = await fn({ player: 'Steve', permission: 'mod.admin' }, CTX);
  assert.equal(r.status, 'error');
  assert.equal(r.error?.code, 'PERMISSION_PROVIDER_UNSUPPORTED');
});

test('profile_get geçersiz giriş TOOL_INPUT_INVALID döner', async () => {
  const [, fn] = tupleHandler(createProfileTools({ supervisor: async () => noRoutes }), 'profile_get');
  const r = await fn({ profile_id: 42 }, CTX);
  assert.equal(r.status, 'error');
  assert.equal(r.error?.code, 'TOOL_INPUT_INVALID');
});

test('profile_get başarı yolu doğru IPC method adını kullanır', async () => {
  let called = false;
  const info = {
    supervisor: async () => makeFakeSupervisor({
      'profile.get': () => { called = true; return { id: 'paper-26.2-build-84-v1', status: 'active', minecraftVersion: '1.26.2', paperBuild: '84', verificationStatus: 'verified', javaVersion: '25', nodeVersion: '24', gradleVersion: '9', mavenVersion: null }; },
    }),
  };
  const [, fn] = tupleHandler(createProfileTools(info), 'profile_get');
  const r = await fn({ profile_id: 'paper-26.2-build-84-v1' }, CTX);
  assert.equal(r.status, 'success');
  assert.equal(called, true);
});

test('scenario_run failed + errorCode EULA_NOT_ACCEPTED catalog mesajıyla tool hatası döner', async () => {
  const info = {
    scenariosDir: '.',
    supervisor: async () => makeFakeSupervisor({
      'scenario.run': () => ({
        scenarioRunId: 'sr_test',
        status: 'failed',
        passed: 0,
        failed: 0,
        skipped: 0,
        durationMs: 150,
        evidenceIds: [],
        errorCode: 'EULA_NOT_ACCEPTED',
        assertions: [],
      }),
    }),
  };
  const [, fn] = tupleHandler(createScenarioTools(info), 'scenario_run');
  const r = await fn(
    {
      scenario_path: 'scenarios/world/read-block.yaml',
      project_id: 'proj_test',
    },
    CTX,
  );
  assert.equal(r.status, 'error');
  assert.equal(r.error?.code, 'EULA_NOT_ACCEPTED');
  assert.equal(r.error?.retryable, false);
  assert.ok(r.error?.suggested_action?.includes('mcpdev eula accept'));
});

test('scenario_run failed, errorCode yoksa ASSERTION_FAILED döner', async () => {
  const info = {
    scenariosDir: '.',
    supervisor: async () => makeFakeSupervisor({
      'scenario.run': () => ({
        scenarioRunId: 'sr_test',
        status: 'failed',
        passed: 2,
        failed: 1,
        skipped: 0,
        durationMs: 5000,
        evidenceIds: ['ev_1'],
        assertions: [],
      }),
    }),
  };
  const [, fn] = tupleHandler(createScenarioTools(info), 'scenario_run');
  const r = await fn(
    {
      scenario_path: 'scenarios/world/read-block.yaml',
      project_id: 'proj_test',
    },
    CTX,
  );
  assert.equal(r.status, 'error');
  assert.equal(r.error?.code, 'ASSERTION_FAILED');
});

test('scenario_run success yanıtı assertion görünürlüğünü taşır', async () => {
  const info = {
    scenariosDir: '.',
    supervisor: async () => makeFakeSupervisor({
      'scenario.run': () => ({
        scenarioRunId: 'sr_test',
        status: 'completed',
        passed: 2,
        failed: 0,
        skipped: 0,
        durationMs: 2500,
        evidenceIds: ['ev_1'],
        assertions: [
          {
            stepName: 'assert.block',
            passed: true,
            message: 'Assertion başarılı.',
            durationMs: 33,
            attempts: 1,
            expected: 'minecraft:chest',
            actual: 'minecraft:chest',
          },
        ],
      }),
    }),
  };
  const [, fn] = tupleHandler(createScenarioTools(info), 'scenario_run');
  const r = await fn(
    {
      scenario_path: 'scenarios/world/read-block.yaml',
      project_id: 'proj_test',
    },
    CTX,
  );
  assert.equal(r.status, 'success');
  const data = r.data as { assertions: Array<{ stepName: string; expected: string; actual: string }> };
  assert.equal(data.assertions.length, 1);
  assert.equal(data.assertions[0]!.stepName, 'assert.block');
  assert.equal(data.assertions[0]!.expected, 'minecraft:chest');
  assert.equal(data.assertions[0]!.actual, 'minecraft:chest');
});