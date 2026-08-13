/**
 * e2e-minimal — gerçek uçtan uca dikey dilim (M3 release-hardening gate).
 *
 * Akış: EULA kabulü (operator) → mcpdev serve → project_inspect →
 *       plugin_build (gerçek Gradle) → plugin_launch (gerçek Paper READY) →
 *       scenario_run (hedef plugin + assertion) → evidence_get → plugin_stop.
 *
 * Bu betik normal test suite'inde KOŞMAZ — gerçek Minecraft EULA kabulü,
 * gerçek Paper JAR ve gerçek Gradle build gerektirir (m0-smoke felsefesi).
 * CI'da ayrı bir iş olarak koşulur (workflows/pr.yml → e2e-minimal).
 *
 * Kullanım:
 *   node apps/mcp-server/e2e/minimal.driver.mjs
 *
 * Ortam:
 *   JAVA_HOME — pinned Java 25 (sunucu Java sürümünü doğrular)
 *   MCPDEV_E2E_REPO_ROOT — repo kökü (varsayılan: script konumundan türetilir)
 *   MCPDEV_E2E_BRIDGE_JAR — bridge plugin JAR yolu (varsayılan: workspace build)
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = dirname(fileURLToPath(import.meta.url));
// apps/mcp-server/e2e -> repo kökü (5 seviye)
const repoRoot = resolve(process.env.MCPDEV_E2E_REPO_ROOT ?? resolve(here, '..', '..', '..'));
const cliEntry = join(repoRoot, 'apps', 'cli', 'dist', 'src', 'index.js');
const bridgeJar = resolve(
  process.env.MCPDEV_E2E_BRIDGE_JAR ??
    join(repoRoot, 'bridge', 'paper', 'build', 'libs', 'paper-bridge-0.1.0-prototype.0.jar'),
);
const profileId = 'paper-26.2-build-84-v1';
const projectId = 'demo';
const projectRoot = join(repoRoot, 'fixtures', 'projects', 'minimal-paper-plugin');
const scenarioPath = join(repoRoot, 'scenarios', 'smoke', 'plugin-enables.yaml');
const paperCacheDir = join(repoRoot, '.cache', 'paper');

function fail(message) {
  console.error(`[e2e-minimal] HATA: ${message}`);
  process.exit(1);
}

function assume(condition, message) {
  if (!condition) fail(message);
  console.log(`[e2e-minimal] OK: ${message}`);
}

for (const [label, path] of [['CLI', cliEntry], ['bridge JAR', bridgeJar], ['proje', projectRoot], ['scenario', scenarioPath]]) {
  if (!existsSync(path)) fail(`${label} bulunamadı: ${path}`);
}

// ─── Bağımlılık cache (offline reproducible build ön koşulu) ──────────
// Agent yüzeyinde network:online provisioning onayı gerektirir (build-plan.ts);
// bu yüzden e2e build offline modda, host ~/.gradle'dan seed edilen doğrulanmış
// cache üzerinden koşar (m1-demo seedGradleCache deseni). CI'da provisioning
// adımı önceden cache'i doldurur.
async function seedGradleCache() {
  const root = join(await mkdtemp(join(tmpdir(), 'mcpdev-e2e-cache-')), 'seed');
  const home = join(homedir(), '.gradle');
  let copied = false;
  for (const rel of ['wrapper/dists', 'caches/modules-2']) {
    const src = join(home, rel);
    if (!existsSync(src)) continue;
    await mkdir(join(root, dirname(rel)), { recursive: true });
    await cp(src, join(root, rel), {
      recursive: true,
      filter: (source) => !/(\.lck|\.lock|\.tmp)$/.test(source),
    });
    copied = true;
  }
  if (!copied) fail('Gradle cache bulunamadı: önce bir provisioning adımı cache\'i doldurmalı (~/.gradle).');
  return root;
}
const dependencyCacheDir = await seedGradleCache();
console.log(`[e2e-minimal] bağımlılık cache seed: ${dependencyCacheDir}`);

// ─── Adım 0: operator EULA kabulü ─────────────────────────────────────
const dataDir = join(await mkdtemp(join(tmpdir(), 'mcpdev-e2e-')), 'data');
await mkdir(dataDir, { recursive: true });

const eula = spawn(process.execPath, [cliEntry, 'eula', 'accept', '--data-dir', dataDir], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, MCPDEV_DATA_DIR: dataDir },
});
let eulaOut = '';
eula.stdout.setEncoding('utf8');
eula.stdout.on('data', (c) => { eulaOut += c; });
eula.stderr.setEncoding('utf8');
eula.stderr.on('data', (c) => { eulaOut += c; });
eula.stdin.end('y\n');
await new Promise((res) => eula.on('close', res));
if (eula.exitCode !== 0) fail(`eula accept başarısız (exit ${eula.exitCode}): ${eulaOut}`);
const eulaFile = join(dataDir, 'config', 'eula.json');
assume(existsSync(eulaFile), 'EULA kabul kaydı yazıldı');

// ─── Adım 1: mcpdev serve ────────────────────────────────────────────
const env = {
  ...process.env,
  MCPDEV_ROOT: repoRoot,
  MCPDEV_DATA_DIR: dataDir,
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    cliEntry,
    'serve',
    '--repo-root', repoRoot,
    '--profile-id', profileId,
    '--bridge-jar', bridgeJar,
    '--paper-cache', paperCacheDir,
    '--project-id', projectId,
    '--project-root', projectRoot,
    '--evidence-dir', join(dataDir, '..', 'evidence'),
    '--eula-file', eulaFile,
    '--dependency-cache-dir', dependencyCacheDir,
  ],
  env,
});

const client = new Client(
  { name: 'e2e-minimal', version: '0.1.0' },
  { versionNegotiation: { mode: { pin: '2026-07-28' } } },
);
await client.connect(transport);
console.log('[e2e-minimal] serve bağlandı (2026-07-28 modern era).');

// Modern era'da structuredContent düz { status, data } döner (facade.ts toCallResult).
const sc = (call) => call.structuredContent;

try {
  // ─── Adım 2: project_inspect ────────────────────────────────────────
  const inspect = sc(await client.callTool({ name: 'project_inspect', arguments: { project_id: projectId } }));
  assume(inspect?.status === 'success', 'project_inspect başarılı');
  const gw = inspect?.data?.gradle_wrapper;
  assume(gw?.found === true && gw?.jarExists === true, 'gradle wrapper keşfedildi');
  assume(inspect?.data?.plugin_metadata?.found === true, 'plugin.yml keşfedildi');

  // ─── Adım 3: plugin_build (gerçek Gradle, offline reproducible) ─────
  console.log('[e2e-minimal] plugin_build başlıyor (gerçek Gradle 9.6.1, trusted-local, offline)...');
  const build = sc(await client.callTool({
    name: 'plugin_build',
    arguments: { project_id: projectId, mode: 'build', backend: 'trusted-local', network: 'offline', timeout_seconds: 300 },
  }));
  if (build?.status !== 'success') fail(`plugin_build başarısız: ${JSON.stringify(build?.error ?? build)}`);
  const buildId = build?.data?.build_id;
  const artifact = build?.data?.artifact?.path;
  assume(typeof buildId === 'string' && buildId.length > 0, `plugin_build tamamlandı (build_id=${buildId})`);
  assume(typeof artifact === 'string' && artifact.length > 0, `build artifact üretildi (${artifact})`);

  // ─── Adım 4: scenario_run (hedef plugin etkileşimi, kendi runtime'ı) ─
  // DSL-11: her scenario kendi disposable runtime'ını kurar ve run() bittiğinde
  // dispose ile RELEASED'a geçirir (quota serbest kalır). Bu yüzden scenario
  // launch'dan ÖNCE koşulur; plugin_launch bittikten sonra STOPPED kalır ve
  // runtime_release tool yüzeyinde olmadığından quota'ya sayılmaya devam eder.
  console.log(`[e2e-minimal] scenario_run(${scenarioPath}, build_id=${buildId})...`);
  const run = sc(await client.callTool({
    name: 'scenario_run',
    arguments: { scenario_path: scenarioPath, project_id: projectId, build_id: buildId },
  }));
  if (run?.status !== 'success') fail(`scenario_run başarısız: ${JSON.stringify(run?.error ?? run)}`);
  assume(Number(run?.data?.passed) >= 1, `senaryo assertion'ları geçti (passed=${run?.data?.passed}/${run?.data?.failed ?? 0})`);
  const evidenceIds = run?.data?.evidence_ids ?? [];
  assume(Array.isArray(evidenceIds) && evidenceIds.length >= 1, `${evidenceIds.length} evidence üretildi`);

  // ─── Adım 5: evidence_get ───────────────────────────────────────────
  const evidence = sc(await client.callTool({ name: 'evidence_get', arguments: { evidence_id: evidenceIds[0] } }));
  assume(evidence?.status === 'success', 'evidence_get başarılı');
  assume(typeof evidence?.data?.checksum === 'string' && evidence?.data?.byte_size > 0, `evidence doğrulandı (${evidence?.data?.byte_size} byte, checksum ${evidence?.data?.checksum?.slice(0, 12)}…)`);

  // ─── Adım 6: plugin_launch (gerçek Paper READY) ─────────────────────
  console.log('[e2e-minimal] plugin_launch başlıyor (gerçek Paper boot)...');
  const launch = sc(await client.callTool({
    name: 'plugin_launch',
    arguments: { project_id: projectId, build_id: buildId },
  }));
  if (launch?.status !== 'success') fail(`plugin_launch başarısız: ${JSON.stringify(launch?.error ?? launch)}`);
  const runtimeId = launch?.data?.runtime_id;
  assume(typeof runtimeId === 'string', `runtime READY (runtime_id=${runtimeId}, bridge_port=${launch?.data?.bridge_port})`);
  assume(launch?.data?.state === 'READY', `runtime durumu READY (${launch?.data?.state})`);

  // ─── Adım 7: plugin_stop (graceful) ─────────────────────────────────
  const stop = sc(await client.callTool({ name: 'plugin_stop', arguments: { runtime_id: runtimeId } }));
  assume(stop?.status === 'success', 'plugin_stop başarılı');
  assume(stop?.data?.graceful === true, `runtime graceful kapandı (exit ${stop?.data?.exit_code})`);

  console.log('[e2e-minimal] ZİNCİR TAMAMLANDI: inspect→build→scenario→evidence→launch→stop');
} finally {
  await client.close();
}