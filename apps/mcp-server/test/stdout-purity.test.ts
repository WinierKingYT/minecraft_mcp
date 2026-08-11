/**
 * CT-MCP-STDOUT-001 — stdout purity
 * CT-MCP-PROTOCOL-001 — stateless protokol yüzeyi (revizyon 2026-07-28)
 * CT-MCP-TOOLLIST-001 — stabil tool listesi
 * CT-MCP-LEGACY-001 — 2025-11-25 client uyumluluğu (legacy shim)
 *
 * INVARIANT (docs/contracts/mcp.md, ADR-0002/ADR-0008):
 *   MCP Server stdout'undaki her byte JSON-RPC transport parser'ından
 *   geçebilmelidir. ADR-0008 sonrası purity SDK'nın StdioServerTransport'u
 *   tarafından sağlanır; bu testler gerçek wire davranışını doğrular.
 *
 * Modern era (2026-07-28) istemcileri claim'li `_meta` taşır; legacy
 * (2025-11-25) istemcileri initialize ile gelir ve SDK legacy shim tarafından
 * servis edilir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startSession, serverEntry, repoRoot } from './helpers/session.js';

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

/** Ham satır yazıp yanıtları satır satır toplar (client yerine doğrudan wire). */
async function rawSession(
  lines: readonly string[],
): Promise<{ stdout: string; responses: JsonRpcLike[]; exitCode: number }> {
  const child = spawn(process.execPath, [serverEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, MCPDEV_ROOT: repoRoot, MCPDEV_LOG_LEVEL: 'DEBUG' },
  });

  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c: string) => {
    stdout += c;
  });
  child.stderr.resume();

  for (const line of lines) {
    child.stdin.write(line);
  }

  const deadline = Date.now() + 5000;
  await new Promise<void>((resolve) => {
    const tick = (): void => {
      const count = stdout.split('\n').filter((l) => l.trim() !== '').length;
      if (count >= lines.length || Date.now() > deadline) {
        resolve();
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
  child.stdin.end();

  const exitCode = await new Promise<number>((res) => child.on('close', (code) => res(code ?? -1)));

  const responses = stdout
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as JsonRpcLike);

  return { stdout, responses, exitCode };
}

test('stdout yalnızca satır sonlandırmalı JSON-RPC mesajları içerir', async () => {
  const { stdout, responses } = await rawSession([
    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } })}\n`,
    `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { _meta: META, name: 'system_health', arguments: {} } })}\n`,
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
  const session = await startSession();
  try {
    const call = await session.client.callTool({ name: 'system_health', arguments: {} });
    assert.equal((call.structuredContent as { status: string }).status, 'success');
  } finally {
    await session.close();
  }
});

test('kaldırılmış initialize yerine legacy shim 2025-11-25 clientları servis eder', async () => {
  // initialize'ı el ile gönderen bir client = legacy (2025-11-25). SDK shim
  // bunu initialize negotiation ile karşılar; tool çağrıları çalışır.
  // Legacy era'da SDK shim structuredContent'i { result: {...} } içinde taşır.
  const session = await startSession({ legacy: true });
  try {
    const call = await session.client.callTool({ name: 'system_health', arguments: {} });
    const wrapped = call.structuredContent as { result?: { status?: string } };
    const unwrapped = (call.structuredContent ?? {}) as { status?: string };
    assert.equal(unwrapped.status ?? wrapped.result?.status, 'success');
  } finally {
    await session.close();
  }
});

test('server/discover opsiyonel keşif sağlar (client modern era)', async () => {
  const session = await startSession();
  try {
    const discover = await session.client.discover();
    // 2026-07-28'de protocolVersion/serverInfo discover result'ında değil
    // `_meta`'da taşınır; client bunları getter'lar üzerinden sunar.
    assert.equal(session.client.getNegotiatedProtocolVersion(), '2026-07-28');
    const serverInfo = session.client.getServerVersion();
    assert.equal(serverInfo?.name, 'minecraft-plugin-dev-mcp');
    assert.ok(
      (discover.capabilities as { tools?: { listChanged?: boolean } }).tools?.listChanged,
      'tools capability listChanged beyan edilmeli',
    );
  } finally {
    await session.close();
  }
});

test('tools/list önbellek metadata taşır (ttlMs + cacheScope)', async () => {
  const session = await startSession();
  try {
    const result = await session.client.listTools();
    const ttlMs = result.ttlMs as number | undefined;
    const cacheScope = result.cacheScope as string | undefined;
    assert.ok(result.tools.length > 0);
    assert.ok((ttlMs ?? 0) > 0, 'liste sonucu ttlMs taşımalı');
    // ADR-0008: spec yalnızca public|private kabul eder; 'server' spec dışıydı.
    assert.equal(cacheScope, 'private');
  } finally {
    await session.close();
  }
});

test('bilinmeyen method domain error değil protokol hatası döndürür', async () => {
  const { responses } = await rawSession([
    `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'no/such/method' })}\n`,
  ]);

  const last = responses.at(-1);
  assert.ok(last?.error, 'protokol hatası bekleniyordu');
  assert.equal((last.error as { code: number }).code, -32601);
  assert.equal(last.result, undefined, 'protokol hatası result taşımamalı');
});

test('bozuk JSON parse error üretir ve akışı bozmaz', async () => {
  const { responses } = await rawSession([
    '{ bu gecerli json degil\n',
    `${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })}\n`,
  ]);

  assert.ok(responses.length >= 1, 'parse hatası yanıtlanmalı');
  const first = responses[0]!;
  if (first.error) {
    assert.equal((first.error as { code: number }).code, -32700);
  }
  const second = responses.at(-1)!;
  assert.equal(second.id, 7, 'parse hatası sonraki isteği bozmamalı');
  assert.deepEqual(second.result, {}, 'ping boş sonuç döndürmeli');
});

test('tools/list sırası deterministiktir (TL-04)', async () => {
  const collect = async (): Promise<string[]> => {
    const session = await startSession();
    try {
      const result = await session.client.listTools();
      return result.tools.map((t) => t.name);
    } finally {
      await session.close();
    }
  };

  const first = await collect();
  const second = await collect();

  assert.deepEqual(first, second, 'aynı profilde tool sırası değişmemeli');
  assert.ok(first.length > 0);
});

test('uygulanmamış tool listeden düşmez, CAPABILITY_UNAVAILABLE veya SUPERVISOR_UNAVAILABLE döner (TL-02, TL-03)', async () => {
  const session = await startSession();
  try {
    const result = await session.client.listTools();
    const names = result.tools.map((t) => t.name);
    assert.ok(names.includes('project_inspect'), 'tool listede kalmalı');

    const call = await session.client.callTool({
      name: 'project_inspect',
      arguments: { project_id: 'test-project' },
    });
    const sc = call.structuredContent as {
      status: string;
      error?: { code: string; suggested_action: string };
    };
    assert.equal(sc.status, 'error');
    // Supervisor olmadan SUPERVISOR_UNAVAILABLE, Supervisor varken CAPABILITY_UNAVAILABLE döner
    assert.ok(
      sc.error?.code === 'CAPABILITY_UNAVAILABLE' || sc.error?.code === 'SUPERVISOR_UNAVAILABLE',
      `hata kodu CAPABILITY_UNAVAILABLE veya SUPERVISOR_UNAVAILABLE olmalı, actual: ${sc.error?.code}`,
    );
    assert.ok((sc.error?.suggested_action.length ?? 0) >= 8, 'KPI-08: önerilen aksiyon zorunlu');
  } finally {
    await session.close();
  }
});

test('system_capabilities profil durumunu ve limitationları taşır', async () => {
  const session = await startSession();
  try {
    const call = await session.client.callTool({ name: 'system_capabilities', arguments: {} });
    const sc = call.structuredContent as {
      status: string;
      warnings?: string[];
      data?: { known_limitations?: string[]; compatibility_profile?: { verification_status?: string } };
    };

    assert.equal(sc.status, 'success');
    assert.ok(
      sc.data?.compatibility_profile?.verification_status,
      'profil doğrulama durumu yanıtta bulunmalı',
    );
    assert.ok(
      (sc.data?.known_limitations ?? []).length >= 3,
      'KPI-11: limitationlar yanıtta taşınmalı',
    );
  } finally {
    await session.close();
  }
});

test('temiz kapanış: client.close() sonrası server süreci çıkar', async () => {
  const session = await startSession();
  await session.client.callTool({ name: 'system_health', arguments: {} });
  await session.close();
  assert.equal(session.child.exitCode, 0, 'temiz kapanışta child exit 0 olmalı');
});
