/**
 * CT-MCP-V11-E2E-001 — V1.1 E2E smoke.
 *
 * MCP Server'ı doğrudan spawn eder ve V1.1 tool hatlarının uçtan uca
 * çalıştığını official SDK client üzerinden doğrular (ADR-0008):
 *   - developer profilinde read-only V1.1 tool'ları (pool_status, pool_list,
 *     profile_list, profile_get, permission_check) tools/list'te yer alır.
 *   - Supervisor bağlı olmadan çağrıldıklarında SUPERVISOR_UNAVAILABLE döner
 *     (ADR-0003: MCP Server Supervisor'ı doğurmaz).
 *   - Giriş doğrulama hatası TOOL_INPUT_INVALID döner.
 *
 * getter'lar R0 olduğu için yalnızca developer profilininde görünür; mutation
 * tool'lar (pool_acquire, permission_attach vb.) scope dışıdır ve listede
 * bulunmamalıdır.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSession } from './helpers/session.js';

const V11_READ_TOOLS = ['pool_status', 'pool_list', 'profile_list', 'profile_get', 'permission_check'];

const V11_MUTATION_TOOLS = ['pool_acquire', 'pool_release', 'permission_attach', 'permission_detach', 'permission_set_op'];

interface CallErrorShape {
  status: string;
  error?: { code: string; suggested_action: string };
}

function asCallError(structuredContent: unknown): CallErrorShape {
  return structuredContent as CallErrorShape;
}

test('developer profili V1.1 read-only toollarını listeler, mutation toolları hariç tutar', async () => {
  const session = await startSession();
  try {
    const result = await session.client.listTools();
    const names = result.tools.map((t) => t.name);

    for (const tool of V11_READ_TOOLS) {
      assert.ok(names.includes(tool), `developer profili ${tool} içermeli`);
    }
    for (const tool of V11_MUTATION_TOOLS) {
      assert.ok(!names.includes(tool), `developer profili mutation tool ${tool} içermemeli`);
    }
  } finally {
    await session.close();
  }
});

test('V11 getter çağrıları Supervisor yokken SUPERVISOR_UNAVAILABLE döner', async () => {
  const session = await startSession();
  try {
    const calls = [
      await session.client.callTool({ name: 'pool_status', arguments: {} }),
      await session.client.callTool({ name: 'profile_list', arguments: {} }),
      await session.client.callTool({ name: 'permission_check', arguments: { player: 'Steve', permission: 'mod.admin' } }),
    ];

    for (const call of calls) {
      const sc = asCallError(call.structuredContent);
      assert.equal(call.isError, true, 'hata olmalı');
      assert.equal(sc.status, 'error');
      assert.equal(sc.error?.code, 'SUPERVISOR_UNAVAILABLE');
      assert.ok((sc.error?.suggested_action.length ?? 0) >= 8, 'KPI-08: önerilen aksiyon zorunlu');
    }
  } finally {
    await session.close();
  }
});

test('V11 giriş doğrulaması manager üzerinde TOOL_INPUT_INVALID döner', async () => {
  const session = await startSession();
  try {
    const call = await session.client.callTool({ name: 'profile_get', arguments: { profile_id: 42 } });
    const sc = asCallError(call.structuredContent);
    assert.equal(sc.status, 'error');
    assert.equal(sc.error?.code, 'TOOL_INPUT_INVALID');
  } finally {
    await session.close();
  }
});

test('debug profili mutation V11 toollarını listeler, R4 toolları dahil her profilden hariç tutar', async () => {
  const session = await startSession({ profile: 'debug' });
  try {
    const result = await session.client.listTools();
    const names = result.tools.map((t) => t.name);

    // Debug profili mutation toolları içermeli
    for (const tool of V11_MUTATION_TOOLS) {
      assert.ok(names.includes(tool), `debug profili ${tool} içermeli`);
    }
    // R0 getter'ları developer profiline aittir; debug onları taşımaz
    assert.ok(!names.includes('pool_status'), 'debug profili pool_status içermemeli');
    assert.ok(!names.includes('profile_get'), 'debug profili profile_get içermemeli');
    // R4 toolları hiçbir profilde yer alamaz (ADR-0007)
    assert.ok(!names.includes('pool_evict'), 'pool_evict hiçbir profilde olmamalı');
    assert.ok(!names.includes('pool_reset'), 'pool_reset hiçbir profilde olmamalı');
    assert.ok(!names.includes('runtime.delete'), 'runtime.delete hiçbir profilde olmamalı');
  } finally {
    await session.close();
  }
});

test('debug profili mutation call supervisor yokken SUPERVISOR_UNAVAILABLE döner', async () => {
  const session = await startSession({ profile: 'debug' });
  try {
    const calls = [
      await session.client.callTool({
        name: 'pool_acquire',
        arguments: { runtime_image_id: 'img', runtime_id: 'rt', boot_id: 'b' },
      }),
      await session.client.callTool({ name: 'permission_attach', arguments: { player: 'Steve', permission: 'mod.admin' } }),
    ];

    for (const call of calls) {
      const sc = asCallError(call.structuredContent);
      assert.equal(call.isError, true, 'hata olmalı');
      assert.equal(sc.status, 'error');
      assert.equal(sc.error?.code, 'SUPERVISOR_UNAVAILABLE');
      assert.ok((sc.error?.suggested_action.length ?? 0) >= 8, 'KPI-08: önerilen aksiyon zorunlu');
    }
  } finally {
    await session.close();
  }
});

test('bilinmeyen profil fallback developer olur ve uyarı üretmez', async () => {
  const session = await startSession({ profile: 'no-such-profile' });
  try {
    const result = await session.client.listTools();
    const names = result.tools.map((t) => t.name);

    // Varsayılan developer süiti korunur
    assert.ok(names.includes('system_health'));
    assert.ok(names.includes('pool_status'));
    assert.ok(!names.includes('pool_acquire'), 'fallback profilde mutation toolları olmamalı');
  } finally {
    await session.close();
  }
});

test('scenario-authoring profili scenario ve evidence toollarını kapsar', async () => {
  const session = await startSession({ profile: 'scenario-authoring' });
  try {
    const result = await session.client.listTools();
    const names = result.tools.map((t) => t.name);

    assert.ok(names.includes('scenario_validate'), 'scenario_validate scenario-authoring profilinde olmalı');
    assert.ok(names.includes('scenario_run'), 'scenario_run scenario-authoring profilinde olmalı');
    assert.ok(names.includes('evidence_get'), 'evidence_get scenario-authoring profilinde olmalı');
  } finally {
    await session.close();
  }
});
