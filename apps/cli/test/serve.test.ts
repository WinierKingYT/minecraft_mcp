/**
 * mcpdev serve — launcher testleri (P0-7).
 *
 * Gerçek supervisor/mcp-server yerine test fixture süreçleri kullanılır
 * (test/fixtures/): spawn argüman aktarımı, kontrol dosyası bekleme, stale
 * pid koruması, exit code yansıması, kapanış zinciri ve startup timeout.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runServe } from '../src/serve.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const fakeSupervisor = join(fixtures, 'fake-supervisor.js');
const fakeMcpServer = join(fixtures, 'fake-mcp-server.js');

const SILENT_LOG = (): void => {};

interface ServeArgs {
  readonly repoRoot: string;
  readonly projectId?: string;
  readonly projectRoot?: string;
  readonly registryFile?: string;
  readonly supervisorMode?: string;
  readonly startupTimeoutMs?: number;
  readonly controlDir?: string;
}

async function makeOutDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'serve-test-'));
}

async function serveWith(args: ServeArgs, env: Record<string, string> = {}): Promise<{ exitCode: number }> {
  const previous = new Map<string, string | undefined>();
  for (const key of ['FAKE_MCP_EXIT', 'FAKE_MCP_DELAY_MS', 'FAKE_SUPERVISOR_MODE', 'FAKE_OUT_DIR']) {
    previous.set(key, process.env[key]);
  }
  for (const [key, value] of Object.entries({
    FAKE_OUT_DIR: args.repoRoot,
    FAKE_SUPERVISOR_MODE: args.supervisorMode ?? 'normal',
    ...env,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await runServe({
      repoRoot: args.repoRoot,
      profileId: 'paper-26.2-build-84-v1',
      bridgeJarPath: join(args.repoRoot, 'bridge.jar'),
      paperCacheDir: join(args.repoRoot, 'cache'),
      ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
      ...(args.projectRoot !== undefined ? { projectRoot: args.projectRoot } : {}),
      ...(args.registryFile !== undefined ? { registryFile: args.registryFile } : {}),
      startupTimeoutMs: args.startupTimeoutMs ?? 5_000,
      controlDir: args.controlDir ?? join(args.repoRoot, 'control'),
      supervisorEntry: fakeSupervisor,
      mcpServerEntry: fakeMcpServer,
      log: SILENT_LOG,
    });
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('serve: supervisor project kaydı ve registry kalıcılık argümanlarını taşır', async () => {
  const outDir = await makeOutDir();
  await mkdir(join(outDir, 'proj'), { recursive: true });

  const { exitCode } = await serveWith({
    repoRoot: outDir,
    projectId: 'demo',
    projectRoot: join(outDir, 'proj'),
    registryFile: join(outDir, 'registry.json'),
  });

  assert.equal(exitCode, 0);
  const args = await readFile(join(outDir, 'supervisor-args.txt'), 'utf8');
  assert.match(args, /--project-id demo/);
  assert.match(args, /--project-root .*proj/);
  assert.match(args, /--registry-file .*registry\.json/);
  assert.match(args, /--repo-root .*serve-test-/);
});

test('serve: project-root yalnızca project-id ile verilebilir', async () => {
  const outDir = await makeOutDir();
  await assert.rejects(
    serveWith({ repoRoot: outDir, projectRoot: join(outDir, 'proj') }),
    /yalnızca --project-id/,
  );
});

test('serve: mcp-server exit code u launcher exit code una yansır', async () => {
  const outDir = await makeOutDir();
  const { exitCode } = await serveWith(
    { repoRoot: outDir },
    { FAKE_MCP_EXIT: '3', FAKE_MCP_DELAY_MS: '100' },
  );
  assert.equal(exitCode, 3);
});

test('serve: mcp-server kapanınca supervisor da sonlandırılır (zincir)', async () => {
  const outDir = await makeOutDir();
  const { exitCode } = await serveWith(
    { repoRoot: outDir },
    { FAKE_MCP_DELAY_MS: '100' },
  );
  assert.equal(exitCode, 0);

  const pid = Number.parseInt(await readFile(join(outDir, 'supervisor-pid.txt'), 'utf8'), 10);
  assert.ok(pid > 0);
  // Süreç yaşamamalı: process.kill(pid, 0) artık hata fırlatır.
  assert.throws(() => process.kill(pid, 0));
});

test('serve: başka pid li stale kontrol dosyası yoksayılır', async () => {
  const outDir = await makeOutDir();
  const controlDir = join(outDir, 'control');
  await mkdir(controlDir, { recursive: true });
  await writeFile(
    join(controlDir, 'supervisor-endpoint.json'),
    JSON.stringify({
      path: '\\\\.\\pipe\\stale-supervisor',
      token: `stale-${'x'.repeat(32)}`,
      pid: 1_999_999_999,
      startedAt: new Date().toISOString(),
    }),
    'utf8',
  );

  const { exitCode } = await serveWith({ repoRoot: outDir, controlDir });
  assert.equal(exitCode, 0);
  // Yoksayılan stale dosya üzerine kendi pid'iyle yazılmış olmalı.
  const endpoint = JSON.parse(
    await readFile(join(controlDir, 'supervisor-endpoint.json'), 'utf8'),
  ) as { pid: number };
  const pid = Number.parseInt(await readFile(join(outDir, 'supervisor-pid.txt'), 'utf8'), 10);
  assert.equal(endpoint.pid, pid);
});

test('serve: kontrol dosyası zaman aşımı hatası fırlatır ve supervisor öldürülür', async () => {
  const outDir = await makeOutDir();
  await assert.rejects(
    serveWith({ repoRoot: outDir, supervisorMode: 'silent', startupTimeoutMs: 800 }),
    /kontrol dosyası/,
  );

  const pid = Number.parseInt(await readFile(join(outDir, 'supervisor-pid.txt'), 'utf8'), 10);
  await new Promise((res) => setTimeout(res, 300));
  assert.throws(() => process.kill(pid, 0), 'timeout sonrası supervisor kapatılmalı');
});

test('serve: registry dosyası ve evidence dizini varsayılan olarak geçilmez', async () => {
  const outDir = await makeOutDir();
  const { exitCode } = await serveWith({ repoRoot: outDir });
  assert.equal(exitCode, 0);
  const args = await readFile(join(outDir, 'supervisor-args.txt'), 'utf8');
  assert.doesNotMatch(args, /--registry-file/);
  assert.doesNotMatch(args, /--evidence-dir/);
});

test('serve: sahte süreçlerin var olduğu doğrulanır (fixture bütünlüğü)', async () => {
  assert.ok(existsSync(fakeSupervisor), 'fake-supervisor fixture derlenmiş olmalı');
  assert.ok(existsSync(fakeMcpServer), 'fake-mcp-server fixture derlenmiş olmalı');
});
