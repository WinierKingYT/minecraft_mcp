/**
 * CT-MCP-STDOUT-001 — stdout purity
 * CT-MCP-PROTOCOL-001 — stateless protokol yüzeyi (revizyon 2026-07-28)
 * CT-MCP-TOOLLIST-001 — stabil tool listesi
 *
 * INVARIANT (docs/contracts/mcp.md, ADR-0002):
 *   MCP Server stdout'undaki her byte JSON-RPC transport parser'ından
 *   geçebilmelidir.
 *
 * NOT: 2026-07-28 revizyonu initialize/initialized el sıkışmasını kaldırmıştır.
 * Bu testler bilinçli olarak handshake YAPMAZ; her istek kendi bağlamını
 * `_meta` içinde taşır.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// dist/test -> dist/src/index.js
const serverEntry = join(here, '..', 'src', 'index.js');
// dist/test -> dist -> mcp-server -> apps -> repo kökü
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

async function runSession(requests: readonly unknown[]): Promise<{ stdout: string; responses: JsonRpcLike[] }> {
  const child = spawn(process.execPath, [serverEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, MCPDEV_ROOT: repoRoot, MCPDEV_LOG_LEVEL: 'DEBUG' },
  });

  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c: string) => {
    stdout += c;
  });
  // stderr bilinçli olarak tüketilir ve yok sayılır: operational log oraya gider.
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

  return { stdout, responses };
}

test('stdout yalnızca satır sonlandırmalı JSON-RPC mesajları içerir', async () => {
  const { stdout, responses } = await runSession([
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { _meta: META, name: 'system_health', arguments: {} } },
  ]);

  assert.ok(stdout.length > 0, 'stdout boş olmamalı');

  for (const line of stdout.split('\n').filter((l) => l.trim() !== '')) {
    assert.doesNotThrow(() => JSON.parse(line), `stdout satırı JSON değil: ${line.slice(0, 120)}`);
    const parsed = JSON.parse(line) as JsonRpcLike;
    assert.equal(parsed.jsonrpc, '2.0', 'her mesaj jsonrpc: "2.0" taşımalı');
  }

  assert.equal(responses.length, 2);
});

test('handshake olmadan ilk istek doğrudan çalışır (stateless çekirdek)', async () => {
  const { responses } = await runSession([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { _meta: META, name: 'system_health', arguments: {} } },
  ]);

  const call = responses[0]?.result as { structuredContent: { status: string } } | undefined;
  assert.equal(call?.structuredContent.status, 'success', 'initialize olmadan tool çağrısı çalışmalı');
});

test('kaldırılmış initialize metodu açık hata döndürür', async () => {
  const { responses } = await runSession([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }]);

  const err = responses[0]?.error as { code: number; message: string } | undefined;
  assert.ok(err, 'initialize artık desteklenmemeli');
  assert.equal(err.code, -32601);
  assert.match(err.message, /kaldırılmıştır/, 'hata mesajı nedeni açıklamalı');
});

test('server/discover opsiyonel keşif sağlar', async () => {
  const { responses } = await runSession([
    { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: META } },
  ]);

  const result = responses[0]?.result as {
    protocolVersion: string;
    serverInfo: { name: string; version: string };
    capabilities: { tools: { listChanged: boolean } };
  };

  assert.equal(result.protocolVersion, '2026-07-28');
  assert.equal(result.serverInfo.name, 'minecraft-plugin-dev-mcp');
  assert.equal(result.capabilities.tools.listChanged, true);
});

test('tools/list önbellek metadata taşır (ttlMs + cacheScope)', async () => {
  const { responses } = await runSession([
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
  ]);

  const result = responses[0]?.result as { tools: unknown[]; ttlMs: number; cacheScope: string };
  assert.ok(result.tools.length > 0);
  assert.ok(result.ttlMs > 0, 'liste sonucu ttlMs taşımalı');
  assert.equal(result.cacheScope, 'server');
});

test('bilinmeyen method domain error değil protokol hatası döndürür', async () => {
  const { responses } = await runSession([{ jsonrpc: '2.0', id: 2, method: 'no/such/method' }]);

  const last = responses.at(-1);
  assert.ok(last?.error, 'protokol hatası bekleniyordu');
  assert.equal((last.error as { code: number }).code, -32601);
  assert.equal(last.result, undefined, 'protokol hatası result taşımamalı');
});

test('bozuk JSON parse error üretir ve akışı bozmaz', async () => {
  const child = spawn(process.execPath, [serverEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, MCPDEV_ROOT: repoRoot },
  });

  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c: string) => {
    stdout += c;
  });
  child.stderr.resume();

  child.stdin.write('{ bu gecerli json degil\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }) + '\n');
  await new Promise((res) => setTimeout(res, 200));
  child.stdin.end();

  await new Promise<void>((res) => child.on('close', () => res()));

  const lines = stdout.split('\n').filter((l) => l.trim() !== '');
  assert.equal(lines.length, 2);

  const first = JSON.parse(lines[0]!) as JsonRpcLike;
  assert.equal((first.error as { code: number }).code, -32700);

  const second = JSON.parse(lines[1]!) as JsonRpcLike;
  assert.equal(second.id, 7, 'parse hatası sonraki isteği bozmamalı');
});

test('tools/list sırası deterministiktir (TL-04)', async () => {
  const collect = async (): Promise<string[]> => {
    const { responses } = await runSession([
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
    ]);
    const result = responses.at(-1)?.result as { tools: Array<{ name: string }> };
    return result.tools.map((t) => t.name);
  };

  const first = await collect();
  const second = await collect();

  assert.deepEqual(first, second, 'aynı profilde tool sırası değişmemeli');
  assert.ok(first.length > 0);
});

test('uygulanmamış tool listeden düşmez, CAPABILITY_UNAVAILABLE veya SUPERVISOR_UNAVAILABLE döner (TL-02, TL-03)', async () => {
  const { responses } = await runSession([
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { _meta: META, name: 'project_inspect', arguments: { project_id: 'test-project' } } },
  ]);

  const listed = (responses[0]?.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  assert.ok(listed.includes('project_inspect'), 'tool listede kalmalı');

  const call = responses[1]?.result as {
    resultType: string;
    isError: boolean;
    structuredContent: { status: string; error?: { code: string; suggested_action: string } };
  };
  assert.equal(call.resultType, 'complete');
  assert.equal(call.isError, true);
  assert.equal(call.structuredContent.status, 'error');
  // Supervisor olmadan SUPERVISOR_UNAVAILABLE, Supervisor varken CAPABILITY_UNAVAILABLE döner
  assert.ok(
    call.structuredContent.error?.code === 'CAPABILITY_UNAVAILABLE' ||
    call.structuredContent.error?.code === 'SUPERVISOR_UNAVAILABLE',
    `hata kodu CAPABILITY_UNAVAILABLE veya SUPERVISOR_UNAVAILABLE olmalı, actual: ${call.structuredContent.error?.code}`,
  );
  assert.ok((call.structuredContent.error?.suggested_action.length ?? 0) >= 8, 'KPI-08: önerilen aksiyon zorunlu');
});

test('system_capabilities profil durumunu ve limitationları taşır', async () => {
  const { responses } = await runSession([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { _meta: META, name: 'system_capabilities', arguments: {} } },
  ]);

  const call = responses.at(-1)?.result as {
    structuredContent: {
      status: string;
      warnings?: string[];
      data?: { known_limitations?: string[]; compatibility_profile?: { verification_status?: string } };
    };
  };

  assert.equal(call.structuredContent.status, 'success');
  assert.ok(
    call.structuredContent.data?.compatibility_profile?.verification_status,
    'profil doğrulama durumu yanıtta bulunmalı',
  );
  assert.ok(
    (call.structuredContent.data?.known_limitations ?? []).length >= 3,
    'KPI-11: limitationlar yanıtta taşınmalı',
  );
});
