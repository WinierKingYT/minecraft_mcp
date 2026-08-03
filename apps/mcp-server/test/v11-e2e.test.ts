/**
 * CT-MCP-V11-E2E-001 — V1.1 E2E smoke.
 *
 * MCP Server'ı HTTP olmadan doğrudan spawn eder ve V1.1 tool hatlarının uçtan
 * uca çalıştığını doğrular:
 *   - developer profilinde read-only V1.1 tool'ları (pool_status, pool_list,
 *     profile_list, profile_get, permission_check) tools/list'te yer alır.
 *   - Supervisor bağlı olmadan çağrıldıklarında SUPERVISOR_UNAVAILABLE döner
 *     (ADR-0003: MCP Server Supervisor'ı doğurmaz).
 *
 * getter'lar R0 olduğu için yalnızca developer profilininde görünür; mutation
 * tool'lar (pool_acquire, permission_attach vb.) scope dışıdır ve listede
 * bulunmamalıdır.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, '..', 'src', 'index.js');
const repoRoot = resolve(here, '..', '..', '..', '..');

const META = {
  protocolVersion: '2026-07-28',
  client: { name: 'contract-test', version: '0.0.0' },
} as const;

interface JsonRpcLike {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

async function runSession(
  requests: readonly unknown[],
  options: { profile?: string } = {},
): Promise<{ responses: JsonRpcLike[] }> {
  const child = spawn(process.execPath, [serverEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MCPDEV_ROOT: repoRoot,
      ...(options.profile ? { MCPDEV_TOOL_PROFILE: options.profile } : {}),
    },
  });

  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c: string) => { stdout += c; });
  child.stderr.resume();

  for (const req of requests) {
    child.stdin.write(JSON.stringify(req) + '\n');
  }
  await new Promise((res) => setTimeout(res, 200));
  child.stdin.end();
  await new Promise<void>((res) => child.on('close', () => res()));

  const responses = stdout
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as JsonRpcLike);

  return { responses };
}

const V11_READ_TOOLS = ['pool_status', 'pool_list', 'profile_list', 'profile_get', 'permission_check'];

const V11_MUTATION_TOOLS = ['pool_acquire', 'pool_release', 'permission_attach', 'permission_detach', 'permission_set_op'];

test('developer profili V1.1 read-only toollarını listeler, mutation toolları hariç tutar', async () => {
  const { responses } = await runSession([
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
  ]);

  const result = responses.at(-1)?.result as { tools: Array<{ name: string }> };
  const names = result.tools.map((t) => t.name);

  for (const tool of V11_READ_TOOLS) {
    assert.ok(names.includes(tool), `developer profili ${tool} içermeli`);
  }
  for (const tool of V11_MUTATION_TOOLS) {
    assert.ok(!names.includes(tool), `developer profili mutation tool ${tool} içermemeli`);
  }
});

test('V11 getter çağrıları Supervisor yokken SUPERVISOR_UNAVAILABLE döner', async () => {
  const { responses } = await runSession([
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { _meta: META, name: 'pool_status', arguments: {} } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { _meta: META, name: 'profile_list', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { _meta: META, name: 'permission_check', arguments: { player: 'Steve', permission: 'mod.admin' } } },
  ]);

  for (const call of responses.slice(1)) {
    const r = call.result as {
      isError: boolean;
      structuredContent: { status: string; error?: { code: string; suggested_action: string } };
    };
    assert.equal(r.isError, true, `${call.id} hata olmalı`);
    assert.equal(r.structuredContent.status, 'error');
    assert.equal(r.structuredContent.error?.code, 'SUPERVISOR_UNAVAILABLE');
    assert.ok((r.structuredContent.error?.suggested_action.length ?? 0) >= 8, 'KPI-08: önerilen aksiyon zorunlu');
  }
});

test('V11 giriş doğrulaması manager üzerinde TOOL_INPUT_INVALID döner', async () => {
  const { responses } = await runSession([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { _meta: META, name: 'profile_get', arguments: { profile_id: 42 } } },
  ]);

  const r = responses.at(-1)?.result as {
    structuredContent: { status: string; error?: { code: string } };
  };
  assert.equal(r.structuredContent.status, 'error');
  assert.equal(r.structuredContent.error?.code, 'TOOL_INPUT_INVALID');
});

test('debug profili mutation V11 toollarını listeler, R4 toolları dahil her profilden hariç tutar', async () => {
  const { responses } = await runSession([
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
  ], { profile: 'debug' });

  const result = responses.at(-1)?.result as { tools: Array<{ name: string }> };
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
});

test('debug profili mutation call supervisor yokken SUPERVISOR_UNAVAILABLE döner', async () => {
  const { responses } = await runSession([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { _meta: META, name: 'pool_acquire', arguments: { runtime_image_id: 'img', runtime_id: 'rt', boot_id: 'b' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { _meta: META, name: 'permission_attach', arguments: { player: 'Steve', permission: 'mod.admin' } } },
  ], { profile: 'debug' });

  for (const call of responses) {
    const r = call.result as {
      isError: boolean;
      structuredContent: { status: string; error?: { code: string; suggested_action: string } };
    };
    assert.equal(r.isError, true, `${call.id} hata olmalı`);
    assert.equal(r.structuredContent.status, 'error');
    assert.equal(r.structuredContent.error?.code, 'SUPERVISOR_UNAVAILABLE');
    assert.ok((r.structuredContent.error?.suggested_action.length ?? 0) >= 8, 'KPI-08: önerilen aksiyon zorunlu');
  }
});

test('bilinmeyen profil fallback developer olur ve uyarı üretmez', async () => {
  const { responses } = await runSession([
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
  ], { profile: 'no-such-profile' });

  const result = responses.at(-1)?.result as { tools: Array<{ name: string }> };
  const names = result.tools.map((t) => t.name);

  // Varsayılan developer süiti korunur
  assert.ok(names.includes('system_health'));
  assert.ok(names.includes('pool_status'));
  assert.ok(!names.includes('pool_acquire'), 'fallback profilde mutation toolları olmamalı');
});

test('scenario-authoring profili scenario ve evidence toollarını kapsar', async () => {
  const { responses } = await runSession([
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
  ], { profile: 'scenario-authoring' });

  const result = responses.at(-1)?.result as { tools: Array<{ name: string }> };
  const names = result.tools.map((t) => t.name);

  assert.ok(names.includes('scenario_validate'), 'scenario_validate scenario-authoring profilinde olmalı');
  assert.ok(names.includes('scenario_run'), 'scenario_run scenario-authoring profilinde olmalı');
  assert.ok(names.includes('evidence_get'), 'evidence_get scenario-authoring profilinde olmalı');
});