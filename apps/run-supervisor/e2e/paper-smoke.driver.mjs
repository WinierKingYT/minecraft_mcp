/**
 * paper-smoke — gerçek Paper 5 lifecycle (M3 release-hardening kapısı).
 *
 * m0-smoke'un deterministik CI karşılığı: gerçek Paper JAR'ı indirir,
 * runtime image kurar, Paper'ı başlatır, READY gate'i bekler (bridge handshake
 * + health + PaperBridge enabled), salt-okuma gözlemleri yapar (health,
 * capabilities, server state, plugin/world listesi, events), negatif kanıtları
 * üretir (yanlış token → 401; world.set_block mutation reddi) ve graceful
 * cleanup'i doğrular.
 *
 * e2e-minimal'den farkı: orada MCP Client zinciri (inspect→build→scenario→
 * launch) kanıtlanır; burada m0-smoke'un M0 iddiası — salt-okuma gözlemle
 * mutation araçlarından arınmış geliştirici yüzeyi — doğrulanır.
 *
 * Bu betik normal test suite'inde KOŞMAZ (m0-smoke felsefesi): gerçek Minecraft
 * EULA kabulü, ~60 MB Paper JAR indirme ve gerçek Paper boot gerektirir.
 * CI'da ayrı bir iş olarak koşulur (workflows/pr.yml → paper-smoke).
 *
 * Kullanım:
 *   node apps/run-supervisor/e2e/paper-smoke.driver.mjs
 *
 * Ortam:
 *   JAVA_HOME — pinned Java (profilin runtime_major'ı, sunucu Java sürümünü doğrular)
 *   MCPDEV_E2E_REPO_ROOT — repo kökü (varsayılan: script konumundan türetilir)
 *   MCPDEV_E2E_BRIDGE_JAR — bridge plugin JAR yolu (varsayılan: workspace build)
 *   MCPDEV_E2E_PAPER_DIR  — Paper JAR cache dizini (varsayılan: repoRoot/.cache/paper)
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runM0Smoke } from '../dist/src/m0-smoke.js';

const here = dirname(fileURLToPath(import.meta.url));
// apps/run-supervisor/e2e -> repo kökü (3 seviye)
const repoRoot = resolve(process.env.MCPDEV_E2E_REPO_ROOT ?? resolve(here, '..', '..', '..'));
const cliEntry = join(repoRoot, 'apps', 'cli', 'dist', 'src', 'index.js');
const bridgeJar = resolve(
  process.env.MCPDEV_E2E_BRIDGE_JAR ??
    join(repoRoot, 'bridge', 'paper', 'build', 'libs', 'paper-bridge-0.1.0-prototype.0.jar'),
);
const paperCacheDir = resolve(process.env.MCPDEV_E2E_PAPER_DIR ?? join(repoRoot, '.cache', 'paper'));
const profileId = 'paper-26.2-build-84-v1';

function fail(message) {
  console.error(`[paper-smoke] HATA: ${message}`);
  process.exit(1);
}

function assume(condition, message) {
  if (!condition) fail(message);
  console.log(`[paper-smoke] OK: ${message}`);
}

for (const [label, path] of [['CLI', cliEntry], ['bridge JAR', bridgeJar]]) {
  if (!existsSync(path)) fail(`${label} bulunamadı: ${path}`);
}

// ─── Adım 0: operator EULA kabulü ─────────────────────────────────────
// EULA kabulü yalnızca operator yüzeyinden (mcpdev eula accept). m0-smoke
// internal olarak acceptMinecraftEula bayrağı ister; bu bayrak burada yalnızca
// operator kaydı başarılı OLDUKTAN SONRA geçirilir. Kayıt başarısızsa hiçbir
// runtime oluşturulmaz.
const dataDir = join(await mkdtemp(join(tmpdir(), 'mcpdev-smoke-')), 'data');
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
assume(existsSync(eulaFile), 'EULA kabulü operator yüzeyinden kayıt edildi');

// ─── Adım 1: m0-smoke (gerçek Paper lifecycle) ────────────────────────
console.log('[paper-smoke] runM0Smoke başlıyor (gerçek Paper boot, ~30s)...');
const evidence = await runM0Smoke({
  repoRoot,
  profileId,
  bridgeJarPath: bridgeJar,
  paperCacheDir,
  acceptMinecraftEula: true, // operator kaydı yukarıda üretildi
  startupTimeoutMs: 300_000,
  log: (m) => console.log(`[paper-smoke]   ${m}`),
});

assume(evidence.readyGateMs >= 0, `ready gate geçti (${evidence.readyGateMs} ms, bridge port ${evidence.bridgePort})`);
assume(typeof evidence.runtimeImageId === 'string' && evidence.runtimeImageId.length > 0, `runtime image kuruldu (${evidence.runtimeImageId})`);
assume(typeof evidence.serverInstanceId === 'string', `server instance ayrıldı (${evidence.serverInstanceId})`);

// Ready gate üç şartı (m0-smoke docs): handshake + health + PaperBridge enabled.
const bridge = String(evidence.capabilities?.['bridge'] ?? '');
assume(typeof evidence.health === 'object' && evidence.health !== null, 'server health okunabilir');
const plugins = Array.isArray(evidence.plugins?.['plugins']) ? evidence.plugins['plugins'] : [];
const bridgePlugin = (plugins ?? []).find((p) => p?.['name'] === 'PaperBridge');
assume(Boolean(bridgePlugin) && bridgePlugin?.['enabled'] === true, `PaperBridge plugin listede (name=${String(bridgePlugin?.['name'] ?? '-')}, enabled=${String(bridgePlugin?.['enabled'] ?? '-')})`);

// Salt-okuma iddiası: dünya ve event gözlemlenir.
const worlds = Array.isArray(evidence.worlds?.['worlds']) ? evidence.worlds['worlds'] : [];
assume(Array.isArray(worlds) && worlds.length >= 1, `${worlds.length} dünya listelendi`);
assume(Array.isArray(evidence.events) && evidence.events.length >= 1, `${evidence.events.length} event gözlemlendi`);

// Negatif kanıtlar (M0'nun özü — mutation geliştiriciye görünmez).
assume(evidence.unauthorizedRejected === true, 'yanlış token reddedildi (401)');
assume(evidence.mutationRejected === true, 'world.set_block mutation reddedildi');

// Cleanup sonucu ana sonuçtan ayrıdır (KPI-12).
assume(evidence.cleanup.graceful === true, `graceful kapandı (exit ${evidence.cleanup.exitCode})`);
assume(evidence.cleanup.forceTerminated === false, 'force termination yok');
assume(evidence.cleanup.portReleased === true, 'bridge portu serbest bırakıldı');
assume(evidence.cleanup.handshakeRemoved === true, 'handshake temizlendi');

console.log('[paper-smoke] PAPER-SMOKE TAMAMLANDI: boot→READY gate→observation→negative→cleanup');
console.log(`[paper-smoke] kanıt: runtime=${evidence.runtimeImageId} ready=${evidence.readyGateMs}ms paper_sha=${evidence.paperJarSha256?.slice(0, 12)}…`);