/**
 * SPIKE-EXECUTION-CONTAINER-001 canlı deney driver'ı.
 *
 * Docker (WSL2 backend) gerektirir. Docker yoksa "atlandı" raporu verir.
 * Deney planı (docs/delivery/spikes/SPIKE-EXECUTION-CONTAINER-001.md):
 *
 *   1. (Q3/Q4) minimal Paper plugin projesi — reproducible modda container build:
 *      `--offline` + read-only dependency cache mount.
 *   2. (Q2)   Aynı izolasyon sınırında Paper + Bridge + hostile-probe runtime
 *      container'ı: handshake doğrulaması + host'tan loopback erişim denemesi.
 *   3. (Q1/Q6) Probe container: env okuma, docker.sock arama, ağ çağrısı,
 *      ro workspace'e yazma, tmpfs yazma.
 *   4. (Q1)   Quota container: disk doldurma (tmpfs), PID bombası, bellek balonu.
 *   5. (Q7/Q8) 20x lifecycle döngüsü: orphan container + disk artığı sayımı.
 *
 * Koşma: JAVA_HOME gerekmez; `node dist/src/spike-container-check.js`.
 * CI'da KOŞMAZ (Docker + ~500 MB image pull).
 */

import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ContainerBackend,
  ContainerBuildEnvironment,
} from './container-backend.js';
import { loadCompatibilityProfile, assertProfileUsable } from './compatibility.js';
import { resolveBuild, downloadPaperJar } from './paper-download.js';

const REPO_ROOT = join(import.meta.dirname, '../../../../');
const PROFILE_ID = 'paper-26.2-build-84-v1';
const MINIMAL_PROJECT = join(REPO_ROOT, 'fixtures', 'projects', 'minimal-paper-plugin');
const BRIDGE_JAR = join(REPO_ROOT, 'bridge/paper/build/libs/paper-bridge-0.1.0-prototype.0.jar');
const HOSTILE_JAR = join(REPO_ROOT, 'fixtures/plugins/hostile-probe/build/libs/hostile-probe-1.0.0.jar');
const PAPER_CACHE = join(REPO_ROOT, '.cache', 'paper');
const BUILD_IMAGE = 'eclipse-temurin:25-jdk';
const PROBE_IMAGE = 'alpine:latest';
// Container içinde `./gradlew` çalıştırılır: wrapper (gradlew + jar + doğrulanmış
// properties) fixture'a kopyalanmıştır (bridge/paper'dan — profil checksum'ıyla).
const BUILD_COMMAND: readonly string[] = ['./gradlew', 'build', '--no-daemon'];

const results: Record<string, unknown>[] = [];

function log(message: string): void {
  console.log(`[spike-container-check] ${message}`);
}

function record(experiment: string, outcome: string, detail: string): void {
  results.push({ experiment, outcome, detail });
  log(`${experiment} = ${outcome} :: ${detail}`);
}

async function main(): Promise<void> {
  const backend = new ContainerBackend({ image: BUILD_IMAGE });
  const availability = await backend.getAvailability();

  if (!availability.available) {
    log(`Docker kullanılamıyor: ${availability.reason} — ${availability.detail ?? ''}`);
    log('Canlı deney ATLANDI (kod tarafı doğrulamaları container-security.test.ts ile yapıldı).');
    return;
  }
  log(`Docker: ${availability.detail ?? 'ok'}`);

  await experiment1OfflineBuild(backend);
  await experiment2RuntimeContainer(backend);
  await experiment3ProbeContainer();
  await experiment4QuotaContainer();
  await experiment5Lifecycle(backend);

  console.log('\n=== SPIKE-EXECUTION-CONTAINER-001 CANLI DENEY ÖZETİ ===');
  console.log(JSON.stringify({ results }, null, 2));
}

// ─── Deney 1: Offline reproducible build (Q3/Q4) ─────────────────────

async function experiment1OfflineBuild(backend: ContainerBackend): Promise<void> {
  log('--- Deney 1: offline build (Q3/Q4) ---');
  const outDir = join(await mkdtemp(join(tmpdir(), 'mcpdev-c1-out-')), 'output');
  const gradleCache = join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '', '.gradle');

  const env = new ContainerBuildEnvironment(backend, MINIMAL_PROJECT, outDir);

  // (a) cache'siz offline — `--network none` + boş GRADLE_USER_HOME'da başarısızlık beklenir.
  const noCache = await env.build('p1', BUILD_COMMAND, {
    network: 'offline',
    timeoutMs: 240_000,
  });
  record(
    'exp1_offline_without_cache',
    noCache.exitCode === 0 ? 'success' : 'blocked',
    noCache.exitCode === 0
      ? `beklenmedik: cache'siz offline build başarılı (exit ${noCache.exitCode})`
      : `cache yokken offline build başarısız oldu (exit ${noCache.exitCode}) — toolchain/dependency sağlanamadı, beklendiği gibi`,
  );

  // (b) ro cache mount ile offline — cache host'ta doluysa başarılı olmalı.
  const withCache = await env.build('p1', BUILD_COMMAND, {
    network: 'offline',
    dependencyCacheDir: gradleCache,
    timeoutMs: 300_000,
  });
  const stderrTail = withCache.stderr.slice(-400).replace(/\n/g, ' | ');
  record(
    'exp1_offline_with_ro_cache',
    withCache.exitCode === 0 ? 'success' : 'blocked',
    withCache.exitCode === 0
      ? 'ro dependency cache mount + --offline ile build tamamlandı (Gradle ro cache kabul etti)'
      : `exit ${withCache.exitCode}; stderr: ${stderrTail}`,
  );

  await rm(outDir, { recursive: true, force: true }).catch(() => undefined);
}

// ─── Deney 2: Runtime container — Paper + Bridge (Q2) ────────────────

async function experiment2RuntimeContainer(backend: ContainerBackend): Promise<void> {
  log('--- Deney 2: runtime container — Paper + Bridge (Q2) ---');

  const profile = loadCompatibilityProfile(REPO_ROOT, PROFILE_ID);
  assertProfileUsable(profile, 'prototype');
  const resolved = await resolveBuild(profile, globalThis.fetch);
  const jar = await downloadPaperJar(resolved, PAPER_CACHE, globalThis.fetch);

  const runtimeRoot = join(await mkdtemp(join(tmpdir(), 'mcpdev-c2-run-')), 'runtime');
  await mkdir(join(runtimeRoot, 'plugins'), { recursive: true });
  await copyFile(jar.path, join(runtimeRoot, 'paper.jar'));
  await writeFile(join(runtimeRoot, 'eula.txt'), 'eula=true\n', 'utf8');
  await writeFile(
    join(runtimeRoot, 'server.properties'),
    'online-mode=false\nlevel-type=flat\ngenerate-structures=false\nspawn-npcs=false\n',
    'utf8',
  );

  // Seed: Paper ilk açılışta mojang_26.2.jar + server jar'ı İNDİRİR (Paperclip).
  // `--network none` runtime container bunu yapamaz; runtime image ön-besleme
  // adımı (M1 "runtime image" provisioning) ağ açık tek kullanımlık container
  // ile Paper'ı bir kez başlatır — bu deney o adımın prototipidir. Seed aynı
  // zamanda world'ü üretir: 9p mount üzerinde world gen yavaştır, "Done"
  // görülene kadar beklenir (aksine runtime testi 240s'de yetişemiyordu).
  log('  seed: Paper ilk açılışı ağ açık container ile koşuluyor (Paperclip indirmeleri + world gen)...');
  const seedName = `mcpdev-seed-${Date.now()}`;
  await dockerRaw(
    ['run', '-d', '--name', seedName, '--volume', `${runtimeRoot}:/app`, '--workdir', '/app', BUILD_IMAGE, 'java', '-jar', '/app/paper.jar', '--nogui'],
    30_000,
  );
  const seedDeadline = Date.now() + 540_000;
  let seedDone = false;
  while (Date.now() < seedDeadline) {
    const latestLog = await readFile(join(runtimeRoot, 'logs', 'latest.log'), 'utf8').catch(() => '');
    if (latestLog.includes('Done (')) {
      seedDone = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  await dockerRaw(['rm', '-f', seedName], 30_000);
  const seeded = seedDone && (await fileExists(join(runtimeRoot, 'cache', 'mojang_26.2.jar')));

  // Bridge + hostile-probe ancak seed'den SONRA eklenir (seed'in yükü olmasın).
  await copyFile(BRIDGE_JAR, join(runtimeRoot, 'plugins', 'paper-bridge.jar'));
  await copyFile(HOSTILE_JAR, join(runtimeRoot, 'plugins', 'hostile-probe.jar'));
  if (!seeded) {
    const latestLog = await readFile(join(runtimeRoot, 'logs', 'latest.log'), 'utf8').catch(() => '');
    record(
      'exp2_paper_ready',
      'blocked',
      `runtime seed başarısız (Done görülmedi / mojang_26.2.jar yok) — log tail: ${latestLog.slice(-300).replace(/\n/g, ' | ')}`,
    );
    await rm(runtimeRoot, { recursive: true, force: true }).catch(() => undefined);
    return;
  }

  const startMs = Date.now();
  // Bridge, yönetilen runtime işaretlerini arar (BridgeRuntimeContext.detect):
  // -Dmcpdev.runtime.root + -Dmcpdev.server.instance.id JVM property'leri,
  // runtime root içinde `.mcpdev-runtime` marker'ı ve `bridge-token` dosyası.
  // Bunlar olmadan Bridge HTTP sunucusunu AÇMAZ (bilinçli güvenlik davranışı).
  const serverInstanceId = `srv_${Date.now()}`;
  const runtimeToken = randomBytes(32).toString('hex');
  await writeFile(join(runtimeRoot, '.mcpdev-runtime'), `managed-runtime-v1\n`, 'utf8');
  await writeFile(join(runtimeRoot, 'bridge-token'), runtimeToken, 'utf8');
  const run = await backend.run({
    workDir: '/app',
    namePrefix: 'mcpdev-runtime',
    // Runtime dizini YAZILABİLİR mount edilir: Paper state'i (world, logs,
    // cache) bu dizine yazar; yalnızca gerçek disposable runtime'ın kendisi
    // writable'dır (build'in ro source'undan farklı olarak).
    mounts: [{ source: runtimeRoot, target: '/app', readonly: false }],
    env: { HOME: '/tmp', JAVA_OPTS: '-Xmx1024M' },
    command: [
      'java',
      `-Dmcpdev.runtime.root=/app`,
      `-Dmcpdev.server.instance.id=${serverInstanceId}`,
      '-jar',
      '/app/paper.jar',
      '--nogui',
    ],
    timeoutMs: 300_000,
  });
  const elapsed = Date.now() - startMs;

  // Handshake: Bridge, runtime root içine bridge-handshake.json yazar (mount'tan görünür).
  const handshakeFile = join(runtimeRoot, 'bridge-handshake.json');
  const handshakeExists = await fileExists(handshakeFile);
  if (handshakeExists) {
    const handshake = JSON.parse(await readFile(handshakeFile, 'utf8'));
    const port = handshake['port'];
    // Sağlıklı bir runtime 300s'lik deadline'a kadar ayakta kalır (timedOut=true,
    // container timeout sonrası temizlenir). Erken çıkış yalnızca crash demektir.
    const crashedEarly = run.timedOut === false && run.exitCode !== 0;
    record(
      'exp2_paper_ready',
      crashedEarly ? 'blocked' : 'success',
      `container içinde Paper + Bridge ayağa kalktı (${elapsed} ms), handshake port=${port}, timedOut=${run.timedOut}, exit=${run.exitCode ?? 'running'}`,
    );

    // Host'tan loopback erişim: Bridge 127.0.0.1:rand bind ettiğinden publish edilemez.
    try {
      await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(3_000) });
      record(
        'exp2_host_loopback_access',
        'success',
        'loopback bind host tarafından erişilebildi (beklenmedik — bind/publish uyumsuzluğu yok)',
      );
    } catch {
      record(
        'exp2_host_loopback_access',
        'blocked',
        'Bridge 127.0.0.1 (loopback) bind ettiği için docker publish ile host tarafından erişilemiyor — supervisor erişim katmanı gerekir (docker exec veya bind ayrımı)',
      );
    }
  } else {
    record(
      'exp2_paper_ready',
      'blocked',
      `container çıktısında handshake yok; exit=${run.exitCode}; stderr: ${run.stderr.slice(-400).replace(/\n/g, ' | ')}; stdout: ${run.stdout.slice(-300).replace(/\n/g, ' | ')}`,
    );
  }

  await rm(runtimeRoot, { recursive: true, force: true }).catch(() => undefined);
}

// ─── Deney 3: Probe container (Q1/Q6) ────────────────────────────────

async function experiment3ProbeContainer(): Promise<void> {
  log('--- Deney 3: probe container (Q1/Q6) ---');
  const probe = new ContainerBackend({ image: PROBE_IMAGE, maxMemoryMb: 256 });

  const envProbe = await probe.run({
    workDir: '/',
    env: { ONLY_ALLOWED: 'yes' },
    command: ['sh', '-c', 'env | grep -E "^(AWS_|GITHUB_|VAULT_|API_KEY)" || echo NO_HOST_SECRET'],
    timeoutMs: 15_000,
  });
  record(
    'exp3_env_leak',
    envProbe.stdout.includes('NO_HOST_SECRET') ? 'blocked' : 'leaked',
    envProbe.stdout.includes('NO_HOST_SECRET')
      ? 'host env değişkenleri container içine sızmadı'
      : `host secret sızdı: ${envProbe.stdout.trim().slice(0, 200)}`,
  );

  const socketProbe = await probe.run({
    workDir: '/',
    command: ['sh', '-c', '[ -e /var/run/docker.sock ] && echo SOCKET_PRESENT || echo NO_SOCKET'],
    timeoutMs: 15_000,
  });
  record(
    'exp3_docker_socket',
    socketProbe.stdout.includes('NO_SOCKET') ? 'blocked' : 'leaked',
    socketProbe.stdout.includes('NO_SOCKET') ? 'docker.sock container içinde yok' : 'docker.sock erişilebilir (kritik)',
  );

  const networkProbe = await probe.run({
    workDir: '/',
    command: ['sh', '-c', 'ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1 && echo NET_OK || echo NET_BLOCKED'],
    timeoutMs: 15_000,
  });
  record(
    'exp3_network',
    networkProbe.stdout.includes('NET_BLOCKED') ? 'blocked' : 'leaked',
    networkProbe.stdout.includes('NET_BLOCKED') ? '--network none ağı kesti' : 'ağ erişimi açık (kritik)',
  );

  const roDir = await mkdtemp(join(tmpdir(), 'mcpdev-probe-ro-'));
  const roWriteProbe = await probe.run({
    workDir: '/',
    mounts: [{ source: roDir, target: '/workspace', readonly: true }],
    command: ['sh', '-c', 'echo x > /workspace/try.txt 2>/dev/null && echo WRITE_OK || echo WRITE_BLOCKED'],
    timeoutMs: 15_000,
  });
  record(
    'exp3_ro_workspace',
    roWriteProbe.stdout.includes('WRITE_BLOCKED') ? 'blocked' : 'leaked',
    roWriteProbe.stdout.includes('WRITE_BLOCKED') ? 'ro mount yazmayı engelledi' : 'ro mounta yazılabildi (kritik)',
  );
  await rm(roDir, { recursive: true, force: true }).catch(() => undefined);

  const tmpWriteProbe = await probe.run({
    workDir: '/',
    command: ['sh', '-c', 'echo x > /tmp/w.txt 2>/dev/null && echo TMP_OK || echo TMP_BLOCKED'],
    timeoutMs: 15_000,
  });
  record(
    'exp3_tmpfs_writable',
    tmpWriteProbe.stdout.includes('TMP_OK') ? 'expected' : 'blocked',
    tmpWriteProbe.stdout.includes('TMP_OK') ? 'tmpfs yazılabilir (disposable writable fs) — beklendiği gibi' : 'tmpfs yazılamadı',
  );
}

// ─── Deney 4: Quota container (Q1) ───────────────────────────────────

async function experiment4QuotaContainer(): Promise<void> {
  log('--- Deney 4: quota container (Q1) ---');
  // tmpfs /tmp 100 MB — 200 MB yazma girişimi fail etmeli.
  const diskProbe = new ContainerBackend({ image: PROBE_IMAGE, maxMemoryMb: 256 });
  const disk = await diskProbe.run({
    workDir: '/',
    command: ['sh', '-c', 'dd if=/dev/zero of=/tmp/big bs=1M count=200 2>/dev/null && echo DISK_OK || echo DISK_BLOCKED'],
    timeoutMs: 30_000,
  });
  record(
    'exp4_disk_quota',
    disk.stdout.includes('DISK_BLOCKED') || disk.exitCode !== 0 ? 'blocked' : 'leaked',
    disk.stdout.includes('DISK_BLOCKED') || disk.exitCode !== 0
      ? `tmpfs 100MB limiti disk doldurmayı engelledi (exit ${disk.exitCode})`
      : `200MB tmpfs'e yazılabildi (limit yok)`,
  );

  // PID bombası: 1500 uyuyan process — pids-limit 512 altında spawn fail etmeli.
  const pidProbe = new ContainerBackend({ image: PROBE_IMAGE, maxMemoryMb: 256, maxPids: 512 });
  const pids = await pidProbe.run({
    workDir: '/',
    command: ['sh', '-c', 'i=0; while [ $i -lt 1500 ]; do sleep 30 & i=$((i+1)); done; sleep 1; echo PIDS_OK || echo PIDS_BLOCKED'],
    timeoutMs: 30_000,
  });
  record(
    'exp4_pid_quota',
    pids.exitCode === 0 && pids.stdout.includes('PIDS_OK') ? 'leaked' : 'blocked',
    pids.exitCode === 0 && pids.stdout.includes('PIDS_OK')
      ? '1500 process spawn edilebildi (pids-limit yok)'
      : `pids-limit 512 process bombasını engelledi (exit ${pids.exitCode})`,
  );

  // Bellek balonu: 256MB cgroup limiti + swap kapalı (--memory-swap = memory).
  // Java 300MB'lık array'e sayfa sayfa dokunur (gerçek anonim bellek); JVM
  // kendi ergonomiyle limiti algılayıp kaçmasın diye -Xmx/-Xms 512m verilir.
  // `dd ... of=/dev/null` ve shell command-substitution AKMAZ (RSS küçük kalır).
  const memProbe = new ContainerBackend({ image: BUILD_IMAGE, maxMemoryMb: 256, maxSwapMb: 256 });
  const mem = await memProbe.run({
    workDir: '/',
    command: [
      'sh', '-c',
      'printf "class B { public static void main(String[] a) { byte[] b = new byte[300*1024*1024]; for (int i = 0; i < b.length; i += 4096) b[i] = 1; System.out.println(\\"DONE\\"); } }" > /tmp/B.java && java -Xmx512m -Xms512m /tmp/B.java; echo rc=$?',
    ],
    timeoutMs: 60_000,
  });
  const rcMatch = mem.stdout.match(/rc=(\d+)/);
  const killed = rcMatch?.[1] === '137';
  record(
    'exp4_mem_quota',
    killed || mem.exitCode === 137 ? 'blocked' : 'leaked',
    `256MB limit (swap kapalı), 300MB anonim bellek tahsisi ${killed ? 'OOM ile öldürüldü (rc=137)' : 'tamamlandı'} (container exit ${mem.exitCode})`,
  );
}

// ─── Deney 5: 20x lifecycle (Q7/Q8) ──────────────────────────────────

async function experiment5Lifecycle(backend: ContainerBackend): Promise<void> {
  log('--- Deney 5: 20x lifecycle (Q7/Q8) ---');
  const probe = new ContainerBackend({ image: PROBE_IMAGE });

  for (let i = 1; i <= 20; i++) {
    const run = await probe.run({
      workDir: '/',
      command: ['sh', '-c', 'exit 0'],
      timeoutMs: 15_000,
    });
    if (run.exitCode !== 0) {
      record('exp5_lifecycle', 'blocked', `döngü ${i}/20 başarısız (exit ${run.exitCode})`);
      return;
    }
  }
  record('exp5_lifecycle', 'success', '20/20 container lifecycle tamamlandı');

  // Orphan sayımı: --rm sonrası hayatta kalan mcpdev-* container.
  const containers = await backend.list('name=mcpdev-');
  const orphans = containers.filter((c) => c.state !== 'exited' && c.state !== 'dead');
  record(
    'exp5_orphans',
    orphans.length === 0 ? 'success' : 'leaked',
    orphans.length === 0
      ? '--rm + --init sonrası orphan container yok'
      : `orphan container bulundu: ${orphans.map((c) => c.name).join(', ')}`,
  );

  const cleaned = await backend.cleanup(0);
  log(`cleanup: ${cleaned} eski container temizlendi`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Ağ açık tek kullanımlık container çalıştırır (seed/provisioning adımları için). */
async function dockerRaw(args: readonly string[], timeoutMs: number): Promise<void> {
  const { stdout, stderr } = await promisify(execFile)('docker', [...args], { timeout: timeoutMs });
  const tail = `${stdout.trim()} ${stderr.trim()}`.trim().slice(-300);
  if (tail.length > 0) log(`  seed çıktısı: ${tail.replace(/\n/g, ' | ')}`);
}

main().catch((error) => {
  console.error('[spike-container-check] BAŞARISIZ:', error);
  process.exit(1);
});
