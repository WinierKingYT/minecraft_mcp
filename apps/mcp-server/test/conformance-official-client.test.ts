/**
 * Official-client conformance matrix — SPIKE-MCP-SDK-2026-001 closure.
 *
 * Kullanıcı onaylı matris (P0-4): 14 testin tamamı @modelcontextprotocol/client
 * 2.0.0 üzerinden, gerçek stdio sürecine karşı koşulur.
 *
 *   01 server discovery
 *   02 protocol negotiation
 *   03 server identity
 *   04 tools/list
 *   05 tool schemas
 *   06 system_health
 *   07 unknown tool
 *   08 malformed tool args
 *   09 supervisor unavailable
 *   10 supervisor available        (skip: supervisor runtime — mcpdev serve E2E)
 *   11 tools/call success
 *   12 tools/call domain error
 *   13 stdout purity
 *   14 clean disconnect
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startSession, serverEntry, repoRoot } from './helpers/session.js';

test('01 server discovery — client.discover() keşif yanıtını döndürür', async () => {
  const session = await startSession();
  try {
    const discover = await session.client.discover();
    // 2026-07-28'de protocolVersion/serverInfo discover result'ında değil
    // `_meta`'da taşınır; client bunları getter'lar üzerinden sunar.
    assert.equal(session.client.getNegotiatedProtocolVersion(), '2026-07-28');
    const caps = discover.capabilities as { tools?: { listChanged?: boolean } };
    assert.ok(caps.tools, 'tools capability beyan edilmeli');
  } finally {
    await session.close();
  }
});

test('02 protocol negotiation — 2026-07-28 pin ile modern era bağlantısı kurulur', async () => {
  const session = await startSession();
  try {
    // Pin'li client bağlanabildiyse negotiation modern era'da tamamlanmıştır.
    assert.equal(session.client.getProtocolEra(), 'modern');
    const tools = await session.client.listTools();
    assert.ok(tools.tools.length > 0);
  } finally {
    await session.close();
  }
});

test('03 server identity — discover serverInfo ürün kimliğini taşır', async () => {
  const session = await startSession();
  try {
    const serverInfo = session.client.getServerVersion();
    assert.equal(serverInfo?.name, 'minecraft-plugin-dev-mcp');
    assert.equal(serverInfo?.version, '0.1.0-prototype.0');
  } finally {
    await session.close();
  }
});

test('04 tools/list — stabil tool listesi döner', async () => {
  const session = await startSession();
  try {
    const result = await session.client.listTools();
    assert.ok(result.tools.length >= 18, `tool sayısı beklenenden az: ${result.tools.length}`);
    const names = result.tools.map((t) => t.name);
    for (const required of ['system_health', 'system_capabilities', 'plugin_build', 'scenario_validate']) {
      assert.ok(names.includes(required), `${required} listede olmalı`);
    }
  } finally {
    await session.close();
  }
});

test('05 tool schemas — her tool inputSchema ve outputSchema taşır', async () => {
  const session = await startSession();
  try {
    const result = await session.client.listTools();
    for (const tool of result.tools) {
      assert.ok(tool.inputSchema, `${tool.name} inputSchema taşımalı`);
      assert.equal(tool.inputSchema?.type, 'object', `${tool.name} inputSchema object olmalı`);
      assert.ok(tool.outputSchema, `${tool.name} outputSchema taşımalı`);
      assert.match(
        JSON.stringify(tool.outputSchema),
        /tool-result\.schema\.json/,
        `${tool.name} outputSchema ortak tool-result şemasına işaret etmeli`,
      );
    }
  } finally {
    await session.close();
  }
});

test('06 system_health — supervisor yokken bile success döner', async () => {
  const session = await startSession();
  try {
    const call = await session.client.callTool({ name: 'system_health', arguments: {} });
    // SDK success yanıtında isError alanını taşımaz (false == yok).
    assert.ok(!call.isError);
    const sc = call.structuredContent as { status: string; data?: { supervisor?: { state: string } } };
    assert.equal(sc.status, 'success');
    assert.ok(sc.data?.supervisor, 'health yanıtı supervisor durumu içermeli');
  } finally {
    await session.close();
  }
});

test('07 unknown tool — JSON-RPC protokol hatası döner', async () => {
  const session = await startSession();
  try {
    await assert.rejects(
      session.client.callTool({ name: 'no_such_tool', arguments: {} }),
      (err: unknown) => {
        const e = err as { code?: number; message?: string };
        return e.code === -32602 && /not found/i.test(e.message ?? '');
      },
    );
  } finally {
    await session.close();
  }
});

test('08 malformed tool args — TOOL_INPUT_INVALID domain hatası döner', async () => {
  const session = await startSession();
  try {
    const call = await session.client.callTool({ name: 'profile_get', arguments: { profile_id: 42 } });
    const sc = call.structuredContent as { status: string; error?: { code: string } };
    assert.equal(sc.status, 'error');
    assert.equal(sc.error?.code, 'TOOL_INPUT_INVALID');
  } finally {
    await session.close();
  }
});

test('09 supervisor unavailable — pool_status SUPERVISOR_UNAVAILABLE döner', async () => {
  const session = await startSession();
  try {
    const call = await session.client.callTool({ name: 'pool_status', arguments: {} });
    const sc = call.structuredContent as { status: string; error?: { code: string } };
    assert.equal(call.isError, true);
    assert.equal(sc.status, 'error');
    assert.equal(sc.error?.code, 'SUPERVISOR_UNAVAILABLE');
  } finally {
    await session.close();
  }
});

test('10 supervisor available — canlı supervisor E2E (mcpdev serve sonrası ayrı test)', {
  skip: 'Supervisor runtime oturumu mcpdev serve launcher (P0-7) sonrası gerçek Paper E2E olarak koşulur.',
}, async () => {
  assert.ok(true);
});

test('11 tools/call success — system_health tam yanıt döndürür', async () => {
  const session = await startSession();
  try {
    const call = await session.client.callTool({ name: 'system_health', arguments: {} });
    // SDK success yanıtında isError alanını taşımaz (false == yok).
    assert.ok(!call.isError);
    assert.ok(Array.isArray(call.content) && call.content.length > 0, 'text content dolu olmalı');
    assert.ok(call.structuredContent, 'structuredContent mevcut olmalı');
  } finally {
    await session.close();
  }
});

test('12 tools/call domain error — structuredContent error + isError işaretli döner', async () => {
  const session = await startSession();
  try {
    const call = await session.client.callTool({ name: 'permission_check', arguments: { player: 'Steve' } });
    const sc = call.structuredContent as { status: string; error?: { code: string } };
    assert.equal(call.isError, true);
    assert.equal(sc.status, 'error');
    assert.equal(sc.error?.code, 'TOOL_INPUT_INVALID');
  } finally {
    await session.close();
  }
});

test('13 stdout purity — süreç stdoutu yalnızca JSON-RPC satırları içerir', async () => {
  const child = spawn(process.execPath, [serverEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, MCPDEV_ROOT: repoRoot },
  });

  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c: string) => { stdout += c; });
  child.stderr.resume();

  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: { protocolVersion: '2026-07-28', client: { name: 'ct', version: '0' } } },
    })}\n`,
  );
  await new Promise((res) => setTimeout(res, 400));
  child.stdin.end();
  await new Promise<void>((res) => child.on('close', () => res()));

  const lines = stdout.split('\n').filter((l) => l.trim() !== '');
  assert.ok(lines.length >= 1, 'en az bir yanıt satırı olmalı');
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line), `stdout satırı JSON değil: ${line.slice(0, 120)}`);
  }
});

test('14 clean disconnect — client.close() ardından server exit 0 olur', async () => {
  const session = await startSession();
  await session.client.callTool({ name: 'system_health', arguments: {} });
  await session.close();
  assert.equal(session.child.exitCode, 0, 'temiz kapanışta exit 0 beklenir');
});
