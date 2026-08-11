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
 *   10 supervisor available        (mcpdev serve launcher — P0-7)
 *   11 tools/call success
 *   12 tools/call domain error
 *   13 stdout purity
 *   14 clean disconnect
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

test('10 supervisor available — mcpdev serve launcher ile canlı supervisor E2E', async () => {
  // P0-7 serve launcher: supervisor (launcher kaydı + registry kalıcılığı) ve
  // mcp-server tek komutta; system_health ve project_list supervisor'ı görür.
  const tmp = await mkdtemp(join(tmpdir(), 'mcpdev-serve-e2e-'));
  const paperCache = join(tmp, 'cache');
  const projRoot = join(tmp, 'proj');
  await mkdir(paperCache, { recursive: true });
  await mkdir(projRoot, { recursive: true });
  const bridgeJar = join(tmp, 'bridge.jar');
  await writeFile(bridgeJar, '', 'utf8');
  const registryFile = join(tmp, 'registry.json');

  const cliEntry = join(repoRoot, 'apps', 'cli', 'dist', 'src', 'index.js');
  assert.ok(existsSync(cliEntry), `cli build eksik: ${cliEntry}`);

  const child = spawn(
    process.execPath,
    [
      cliEntry,
      'serve',
      '--repo-root', repoRoot,
      '--profile-id', 'paper-26.2-build-84-v1',
      '--bridge-jar', bridgeJar,
      '--paper-cache', paperCache,
      '--project-id', 'demo',
      '--project-root', projRoot,
      '--registry-file', registryFile,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } },
  );

  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c: string) => { stdout += c; });
  child.stderr.resume();

  const send = (id: number, method: string, params: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  };
  const meta = { protocolVersion: '2026-07-28', client: { name: 'ct10', version: '0' } };

  send(1, 'initialize', { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'ct10', version: '0' } });
  send(2, 'tools/list', { _meta: meta });
  send(3, 'tools/call', { name: 'system_health', arguments: {}, _meta: meta });
  send(4, 'tools/call', { name: 'project_list', arguments: {}, _meta: meta });

  const deadline = Date.now() + 45_000;
  const responses = new Map<number, Record<string, unknown>>();
  while (responses.size < 4 && Date.now() < deadline) {
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const msg = JSON.parse(trimmed) as { id?: number; result?: Record<string, unknown>; error?: unknown };
        if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
          responses.set(msg.id, msg);
        }
      } catch {
        // Protokol dışı satır yok sayılır (supervisor logları stderr'e gider).
      }
    }
    if (responses.size < 4) {
      await new Promise((res) => setTimeout(res, 200));
    }
  }

  child.stdin.end();
  await new Promise<void>((res) => child.on('close', () => res()));
  assert.equal(child.exitCode, 0, 'mcpdev serve temiz kapanmalı (exit 0)');

  assert.ok(responses.has(1), 'initialize yanıtı alınmalı');
  const list = responses.get(2)?.result as { tools?: Array<{ name: string }> };
  assert.ok(list?.tools?.some((t) => t.name === 'system_health'), 'tools/list system_health içermeli');
  assert.ok(list?.tools?.some((t) => t.name === 'project_list'), 'tools/list project_list içermeli');

  const health = responses.get(3)?.result as {
    structuredContent?: {
      result?: {
        status?: string;
        data?: {
          mcp_server?: { status?: string };
          supervisor?: { status?: string; pid?: number };
        };
      };
    };
  };
  const healthSc = health?.structuredContent?.result;
  assert.equal(healthSc?.status, 'success');
  assert.equal(healthSc?.data?.mcp_server?.status, 'ok', 'mcp-server health ok olmalı');
  assert.equal(healthSc?.data?.supervisor?.status, 'ok', 'supervisor health ok olmalı');
  assert.ok(Number.isInteger(healthSc?.data?.supervisor?.pid), 'supervisor pid raporlanmalı');

  const projects = responses.get(4)?.result as {
    structuredContent?: {
      result?: {
        status?: string;
        data?: { projects?: Array<{ project_id: string; trust_level: string }> };
      };
    };
  };
  const projectsSc = projects?.structuredContent?.result;
  assert.equal(projectsSc?.status, 'success');
  const demo = projectsSc?.data?.projects?.find((p) => p.project_id === 'demo');
  assert.ok(demo, 'launcher kaydı (--project-id) project_list te görünmeli');
  assert.equal(demo?.trust_level, 'approved-fixture');

  // Launcher kaydı kalıcılık dosyasına da yazılmış olmalı (P0-4k flush).
  const persisted = JSON.parse(await readFile(registryFile, 'utf8')) as {
    projects?: Array<{ id: string }>;
  };
  assert.ok(persisted.projects?.some((p) => p.id === 'demo'), 'registry dosyası demo kaydını taşımalı');
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
