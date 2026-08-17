/**
 * mcpdev config — MCP client auto-configuration unit tests (Phase 2).
 *
 * Dört istemci şeması (Claude Desktop, VSCode, Cursor, opencode) için
 * dosya hedefi, container anahtarı ve server tanımı üretimi doğrulanır ve
 * yazma davranışı (create/identical/conflict/force/invalid-json) test edilir.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { detectLayoutFrom } from '../src/layout.js';
import {
  clientConfigPath,
  containerKey,
  buildServerEntry,
  cliEntry,
  runConfig,
  MCP_SERVER_NAME,
  type McpClientId,
} from '../src/config.js';

const CLIENTS: McpClientId[] = ['claude', 'vscode', 'cursor', 'opencode'];

async function makeStandaloneLayout(): Promise<ReturnType<typeof detectLayoutFrom>> {
  const root = await mkdtemp(join(tmpdir(), 'config-standalone-'));
  await mkdir(join(root, 'dist', 'cli', 'src'), { recursive: true });
  await mkdir(join(root, 'dist', 'content'), { recursive: true });
  await writeFile(join(root, 'STANDALONE'), '# mcpdev standalone\n');
  return detectLayoutFrom(join(root, 'dist', 'cli', 'src'));
}

async function makeWorkspaceLayout(): Promise<ReturnType<typeof detectLayoutFrom>> {
  const root = await mkdtemp(join(tmpdir(), 'config-workspace-'));
  await mkdir(join(root, 'apps', 'cli', 'dist', 'src'), { recursive: true });
  return detectLayoutFrom(join(root, 'apps', 'cli', 'dist', 'src'));
}

/** Claude config yolu (homeDir override ile): CLI'daki aynı kural. */
function expectedClaudePath(home: string): string {
  if (process.platform === 'win32') return join(home, 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

describe('mcpdev config: target file paths', () => {
  test('claude → platform-dependent claude_desktop_config.json', () => {
    const home = join(tmpdir(), 'cfg-home');
    assert.equal(clientConfigPath('claude', { homeDir: home }), expectedClaudePath(home));
  });

  test('vscode → <workspaceRoot>/.vscode/mcp.json', () => {
    const ws = join(tmpdir(), 'cfg-ws');
    assert.equal(
      clientConfigPath('vscode', { workspaceRoot: ws }),
      join(ws, '.vscode', 'mcp.json'),
    );
  });

  test('cursor → ~/.cursor/mcp.json', () => {
    const home = join(tmpdir(), 'cfg-home');
    assert.equal(clientConfigPath('cursor', { homeDir: home }), join(home, '.cursor', 'mcp.json'));
  });

  test('opencode → ~/.config/opencode/opencode.json', () => {
    const home = join(tmpdir(), 'cfg-home');
    assert.equal(
      clientConfigPath('opencode', { homeDir: home }),
      join(home, '.config', 'opencode', 'opencode.json'),
    );
  });
});

describe('mcpdev config: server entry + container', () => {
  test('claude/cursor → mcpServers.container, {command,args} şekli', async () => {
    const layout = await makeStandaloneLayout();
    for (const client of ['claude', 'cursor'] as const) {
      const entry = buildServerEntry(client, layout);
      assert.equal(containerKey(client), 'mcpServers');
      assert.equal(entry['command'], process.execPath);
      assert.deepEqual(entry['args'], [cliEntry(layout), 'serve']);
    }
  });

  test('vscode → servers.container, {type:"stdio",...}', async () => {
    const layout = await makeStandaloneLayout();
    const entry = buildServerEntry('vscode', layout);
    assert.equal(containerKey('vscode'), 'servers');
    assert.equal(entry['type'], 'stdio');
    assert.equal(entry['command'], process.execPath);
    assert.deepEqual(entry['args'], [cliEntry(layout), 'serve']);
  });

  test('opencode → mcp.container, {type:"local", command:[...], enabled:true}', async () => {
    const layout = await makeStandaloneLayout();
    const entry = buildServerEntry('opencode', layout);
    assert.equal(containerKey('opencode'), 'mcp');
    assert.equal(entry['type'], 'local');
    assert.equal(entry['enabled'], true);
    assert.deepEqual(entry['command'], [process.execPath, cliEntry(layout), 'serve']);
  });

  test('cliEntry standalone kökünü ve workspace repo kökünü doğru çözer', async () => {
    const standalone = await makeStandaloneLayout();
    assert.equal(cliEntry(standalone), join(standalone.root, 'dist', 'cli', 'src', 'index.js'));

    const workspace = await makeWorkspaceLayout();
    assert.equal(
      cliEntry(workspace),
      join(workspace.root, 'apps', 'cli', 'dist', 'src', 'index.js'),
    );
  });
});

describe('mcpdev config: runConfig create/identical/conflict/force', () => {
  test('ilk çalıştırmada dosya oluşturur, exit 0, doğru container/entry', async () => {
    const layout = await makeStandaloneLayout();
    const home = await mkdtemp(join(tmpdir(), 'cfg-run-home-'));
    const filePath = join(home, '.cursor', 'mcp.json');
    const exit = await runConfig({ client: 'cursor', homeDir: home, layout });
    assert.equal(exit, 0);
    assert.equal(existsSync(filePath), true);
    const root = JSON.parse(await readFile(filePath, 'utf8'));
    assert.deepEqual(root['mcpServers'][MCP_SERVER_NAME], {
      command: process.execPath,
      args: [cliEntry(layout), 'serve'],
    });
  });

  test('aynı tanım → identical, exit 0, dosya değişmez', async () => {
    const layout = await makeStandaloneLayout();
    const home = await mkdtemp(join(tmpdir(), 'cfg-run-home-'));
    const exit1 = await runConfig({ client: 'claude', homeDir: home, layout });
    assert.equal(exit1, 0);
    const filePath = clientConfigPath('claude', { homeDir: home });
    const before = await readFile(filePath, 'utf8');
    const exit2 = await runConfig({ client: 'claude', homeDir: home, layout });
    assert.equal(exit2, 0);
    assert.equal(await readFile(filePath, 'utf8'), before);
  });

  test('farklı tanım → conflict exit 1, dosya değişmez; --force ile günceller', async () => {
    const layout = await makeStandaloneLayout();
    const home = await mkdtemp(join(tmpdir(), 'cfg-run-home-'));
    const filePath = join(home, '.cursor', 'mcp.json');
    await mkdir(join(home, '.cursor'), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ mcpServers: { mcpdev: { command: '/old/node', args: ['serve'] } } }),
      'utf8',
    );

    const conflict = await runConfig({ client: 'cursor', homeDir: home, layout });
    assert.equal(conflict, 1);
    const afterConflict = JSON.parse(await readFile(filePath, 'utf8'));
    assert.deepEqual(afterConflict['mcpServers']['mcpdev'], {
      command: '/old/node',
      args: ['serve'],
    });

    const force = await runConfig({ client: 'cursor', homeDir: home, layout, force: true });
    assert.equal(force, 0);
    const afterForce = JSON.parse(await readFile(filePath, 'utf8'));
    assert.deepEqual(afterForce['mcpServers']['mcpdev'], {
      command: process.execPath,
      args: [cliEntry(layout), 'serve'],
    });
  });

  test('mevcut diğer anahtarlar (configured servers, $schema) korunur', async () => {
    const layout = await makeStandaloneLayout();
    const home = await mkdtemp(join(tmpdir(), 'cfg-run-home-'));
    const filePath = join(home, '.config', 'opencode', 'opencode.json');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        mcp: { other: { type: 'local', command: ['bun', 'x', 'other-mcp'] } },
      }),
      'utf8',
    );

    const exit = await runConfig({ client: 'opencode', homeDir: home, layout });
    assert.equal(exit, 0);
    const root = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(root['$schema'], 'https://opencode.ai/config.json');
    assert.deepEqual(root['mcp']['other'], { type: 'local', command: ['bun', 'x', 'other-mcp'] });
    assert.deepEqual(root['mcp']['mcpdev'], {
      type: 'local',
      command: [process.execPath, cliEntry(layout), 'serve'],
      enabled: true,
    });
  });

  test('geçersiz mevcut JSON → hata, dokunmaz', async () => {
    const layout = await makeStandaloneLayout();
    const home = await mkdtemp(join(tmpdir(), 'cfg-run-home-'));
    const filePath = join(home, '.cursor', 'mcp.json');
    await mkdir(join(home, '.cursor'), { recursive: true });
    await writeFile(filePath, '{not json', 'utf8');
    await assert.rejects(
      () => runConfig({ client: 'cursor', homeDir: home, layout }),
      /JSON ayrıştırılamıyor/,
    );
    assert.equal(await readFile(filePath, 'utf8'), '{not json');
  });

  test('workspace düzeni entry yolu repo apps/cli/dist altına işaret eder', async () => {
    const layout = await makeWorkspaceLayout();
    const home = await mkdtemp(join(tmpdir(), 'cfg-run-home-'));
    const exit = await runConfig({ client: 'vscode', homeDir: home, layout, workspaceRoot: layout.root });
    assert.equal(exit, 0);
    const filePath = join(layout.root, '.vscode', 'mcp.json');
    const root = JSON.parse(await readFile(filePath, 'utf8'));
    assert.deepEqual(root['servers']['mcpdev']['args'], [cliEntry(layout), 'serve']);
  });
});