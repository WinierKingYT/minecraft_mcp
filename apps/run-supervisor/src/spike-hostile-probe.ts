/**
 * SPIKE-SAME-JVM-THREAT-001 canlı deney driver'ı.
 *
 * GERÇEK Paper başlatır (EULA kabulü + ~60 MB Paper JAR gerekir), hostile-probe
 * fixture plugin'ini runtime'a yükler ve beş denemenin sonuçlarını
 * hostile-probe-results.json üzerinden toplar:
 *
 *   1. token arama (env / property / filesystem / reflection)
 *   2. Bridge endpoint'ine yetkisiz istek
 *   3. evidence dosyası değiştirme
 *   4. sahte event enjeksiyonu
 *   5. main thread bloklama (DoS) — supervisor ölçüm penceresiyle eşleşir
 *
 * Bu script normal CI'da KOŞMAZ (docs/operations/m0-smoke.md ile aynı gerekçe).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadCompatibilityProfile, assertProfileUsable } from './compatibility.js';
import { resolveJavaForProfile } from './java-toolchain.js';
import { resolveBuild, downloadPaperJar } from './paper-download.js';
import { createRuntimeImage } from './runtime-image.js';
import { launchPaper, stopPaper } from './runtime-launch.js';

const PROFILE_ID = 'paper-26.2-build-84-v1';
const BRIDGE_JAR = join(import.meta.dirname, '../../../../bridge/paper/build/libs/paper-bridge-0.1.0-prototype.0.jar');
const HOSTILE_JAR = join(import.meta.dirname, '../../../../fixtures/plugins/hostile-probe/build/libs/hostile-probe-1.0.0.jar');
const REPO_ROOT = join(import.meta.dirname, '../../../../');
const RESULT_FILE = 'hostile-probe-results.json';
/** Plugin'in main thread'i bloke edeceği tick sayısı (900 tick = 45 sn). */
const BLOCK_STARTS_AT_MS = 45_000;
/** Plugin'in blok süresi. */
const BLOCK_DURATION_MS = 20_000;

function log(message: string): void {
  console.log(`[spike-hostile-probe] ${message}`);
}

async function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function main(): Promise<void> {
  const repoRoot = REPO_ROOT;
  const profile = loadCompatibilityProfile(repoRoot, PROFILE_ID);
  assertProfileUsable(profile, 'prototype');
  log(`profil: ${profile.id} (${profile.verification.status})`);

  const java = await resolveJavaForProfile(profile.java.runtime_major);
  log(`java  : ${java.versionString}`);

  const resolved = await resolveBuild(profile, globalThis.fetch);
  const jar = await downloadPaperJar(resolved, join(repoRoot, '.cache', 'paper'), globalThis.fetch);
  log(`paper : build ${resolved.build}, cache=${jar.fromCache}`);

  const serverInstanceId = `srv_${randomBytes(12).toString('hex')}`;
  const runtimeRoot = join(await mkdtemp(join(tmpdir(), 'mcpdev-hostile-')), 'runtime');

  const image = await createRuntimeImage({
    runtimeRoot,
    serverInstanceId,
    paperJarPath: jar.path,
    bridgeJarPath: BRIDGE_JAR,
    targetPluginPaths: [HOSTILE_JAR],
    profile,
    acceptMinecraftEula: true,
  });
  log(`runtime: ${image.runtimeImageId}`);

  const startedAt = Date.now();
  const runtime = await launchPaper({
    image,
    javaExecutable: java.executable,
    startupTimeoutMs: 300_000,
  });
  log(`ready  : ${Date.now() - startedAt} ms, bridge port ${runtime.handshake.port}`);

  const summary: Record<string, unknown> = {
    runtimeImageId: image.runtimeImageId,
    serverInstanceId,
    bridgeBootId: runtime.handshake.bridge_boot_id,
    bridgePort: runtime.handshake.port,
    readyGateMs: Date.now() - startedAt,
  };

  try {
    // ---- Deney 1-4: plugin onEnable'da koştu; sonuç dosyası final:false. ----
    await waitForFile(join(runtimeRoot, RESULT_FILE), 30_000);
    const early = JSON.parse(await readFile(join(runtimeRoot, RESULT_FILE), 'utf8'));
    log('deney 1-4 sonuçları alındı (final=false):');
    for (const r of early.results ?? []) {
      log(`  ${r.experiment} = ${r.outcome}`);
    }

    // ---- Deney 5: main thread blok penceresinde supervisor ölçümü. ----
    // Blok başlamadan hemen önce ve blok sırasında sağlık sorgusu gecikmesi ölçülür.
    const baselineMs = await measureHealthLatency(runtime.client);
    log(`blok öncesi health gecikmesi: ${baselineMs} ms`);

    const blockProbeResults: Record<string, unknown>[] = [];
    const blockStart = Date.now() + Math.max(0, BLOCK_STARTS_AT_MS - (Date.now() - startedAt));
    while (Date.now() < blockStart + BLOCK_DURATION_MS + 2_000) {
      await delay(1_000);
      const latency = await measureHealthLatency(runtime.client);
      const duringBlock = Date.now() - blockStart >= 0;
      if (duringBlock) {
        blockProbeResults.push({ t_ms: Date.now() - blockStart, latency_ms: latency });
      }
      if (Date.now() > blockStart + BLOCK_DURATION_MS + 1_000) break;
    }
    log(`blok penceresi ölçümleri (${blockProbeResults.length}):`);
    for (const p of blockProbeResults) {
      log(`  t=${p['t_ms']} ms -> ${p['latency_ms']} ms`);
    }
    summary['block_probes'] = blockProbeResults;

    // ---- Deney 5 sonucu: plugin blok bitince final:true yazar. ----
    await waitForFile(join(runtimeRoot, RESULT_FILE), 30_000);
    const finalDoc = JSON.parse(await readFile(join(runtimeRoot, RESULT_FILE), 'utf8'));
    log('final sonuçlar:');
    for (const r of finalDoc.results ?? []) {
      log(`  ${r.experiment} = ${r.outcome} :: ${r.detail}`);
    }
    summary['results'] = finalDoc.results;
    summary['baseline_health_ms'] = baselineMs;

    const cleanup = await stopPaper(runtime);
    log(`cleanup: graceful=${cleanup.graceful} force=${cleanup.forceTerminated} port=${cleanup.portReleased}`);

    console.log('\n=== SPIKE-SAME-JVM-THREAT-001 CANLI DENEY ÖZETİ ===');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (runtime.process.exitCode === null && runtime.process.signalCode === null) {
      await stopPaper(runtime, 10_000).catch(() => undefined);
    }
    await rm(runtimeRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function waitForFile(file: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(file, 'utf8');
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error(`beklenen dosya oluşmadı: ${file}`);
}

async function measureHealthLatency(
  client: { health: () => Promise<Record<string, unknown>> },
): Promise<number> {
  const start = Date.now();
  try {
    await client.health();
    return Date.now() - start;
  } catch {
    return Date.now() - start;
  }
}

main().catch((error) => {
  console.error('[spike-hostile-probe] BAŞARISIZ:', error);
  process.exit(1);
});
