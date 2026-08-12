/**
 * mcpdev eula — operator EULA yönetimi testleri.
 *
 * CLI entry spawn edilir (gerçek kullanıcı deneyimi): interaktif onay,
 * kabul dosyası yazımı (config/eula.json, mode 0600), durum sorgusu ve
 * yeniden onayın istenmemesi.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(here, '..', '..', 'dist', 'src', 'index.js');

async function runCli(
  args: string[],
  input = '',
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => (stdout += c));
    child.stderr.on('data', (c: string) => (stderr += c));
    child.on('close', (code) => resolveResult({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function makeDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'eula-test-'));
}

test('eula status: kabul yoksa has-not-been-accepted döner', async () => {
  const dataDir = await makeDataDir();
  const r = await runCli(['eula', 'status', '--data-dir', dataDir]);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('has not been accepted'));
  assert.equal(existsSync(join(dataDir, 'config', 'eula.json')), false);
});

test('eula accept: interaktif y onayı kabul dosyası yazar (mode 0600)', async () => {
  const dataDir = await makeDataDir();
  const r = await runCli(['eula', 'accept', '--data-dir', dataDir], 'y\n');
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes('accepted'));

  const file = join(dataDir, 'config', 'eula.json');
  assert.equal(existsSync(file), true);
  if (process.platform !== 'win32') {
    const mode = statSync(file).mode & 0o777;
    assert.equal(mode, 0o600, `beklenen 0600, alınan ${mode.toString(8)}`);
  }

  const state = JSON.parse(await readFile(file, 'utf8')) as { accepted: boolean };
  assert.equal(state.accepted, true);
});

test('eula accept: hayır onayı dosya yazmaz ve exit 1 döner', async () => {
  const dataDir = await makeDataDir();
  const r = await runCli(['eula', 'accept', '--data-dir', dataDir], 'n\n');
  assert.equal(r.code, 1);
  assert.ok(r.stdout.includes('Declined'));
  assert.equal(existsSync(join(dataDir, 'config', 'eula.json')), false);
});

test('eula accept: zaten kabul edilmişse tekrar sormaz', async () => {
  const dataDir = await makeDataDir();
  const first = await runCli(['eula', 'accept', '--data-dir', dataDir], 'y\n');
  assert.equal(first.code, 0);
  const second = await runCli(['eula', 'accept', '--data-dir', dataDir], '');
  assert.equal(second.code, 0);
  assert.ok(second.stdout.includes('already accepted'));
});

test('eula accept: MCPDEV_DATA_DIR env default olarak kullanılır', async () => {
  const dataDir = await makeDataDir();
  const r = await runCli(['eula', 'accept'], 'y\n', { MCPDEV_DATA_DIR: dataDir });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(existsSync(join(dataDir, 'config', 'eula.json')), true);
});

test('eula status: kabul sonrası kayıt bilgisini gösterir', async () => {
  const dataDir = await makeDataDir();
  const accept = await runCli(['eula', 'accept', '--data-dir', dataDir], 'y\n');
  assert.equal(accept.code, 0);
  const r = await runCli(['eula', 'status', '--data-dir', dataDir]);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('accepted'));
  assert.ok(r.stdout.includes('Record:'));
});
