/**
 * ST-MALICIOUS-CONTAINER-* — Malicious plugin container testi.
 *
 * `fixtures/plugins/hostile-probe` (SPIKE-SAME-JVM-THREAT-001 ölçüm probu) bir
 * runtime container'a yüklenseydi hangi hostile davranışları deneyeceğinin
 * otomatik CI karşılığı. İki katman:
 *
 * 1. Hermetic (Docker gerektirmez — her platformda koşar):
 *    - hostile-probe fixture'ının build edilebilirliği (build.gradle.kts,
 *      plugin.yml, hostile deneylerini içeren kaynak).
 *    - Container izolasyon argümanlarının hostile davranışları engellemesi
 *      (docker.sock yok, --privileged yok, --network none, ro workspace).
 *
 * 2. Canlı (Docker varsa): alpine probe container'ları ile hostile eylemlerin
 *    GERÇEKTEN engellendiği doğrulanır — env sızıntısı yok, docker.sock yok,
 *    ağ yok, ro mount yazma engeli, tmpfs disposable, disk quota, pid quota.
 *    Docker yoksa bu katman skip edilir (container-security.test.ts deseni;
 *    CI'da Windows runner MCPDEV_SKIP_DOCKER=1 ile zorla skip eder).
 *
 * Ağır (JDK image gerektiren) bellek balonu deneyi spike-container-check.ts
 * exp4_mem_quota'da kalır; bellek limiti zaten container-security.test.ts'te
 * argüman + cgroup okumasıyla doğrulanır.
 */

import { describe, test, before, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ContainerBackend, buildDockerRunArgs } from '../src/container-backend.js';

// dist/test/*.test.js altında import.meta.dirname = apps/run-supervisor/dist/test.
// Repo köküne 4 düzey: test -> dist -> run-supervisor -> apps -> repo root.
const FIXTURE_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'plugins', 'hostile-probe');

let dockerAvailable = false;

before(async () => {
  if (process.env.MCPDEV_SKIP_DOCKER === '1') {
    dockerAvailable = false;
    return;
  }
  dockerAvailable = await new ContainerBackend().isAvailable();
});

function skipIfNoDocker(ctx: TestContext): boolean {
  if (!dockerAvailable) {
    ctx.skip('Docker mevcut değil');
    return true;
  }
  return false;
}

/** Hostile plugin runtime'ı için üretilen gerçek izolasyon argümanları. */
function hostileRuntimeArgs() {
  return buildDockerRunArgs({
    containerName: 'mcpdev-runtime-hostile-test',
    image: 'mcpdev-runtime:latest',
    command: ['java', '-Dmcpdev.runtime.root=/app', '-jar', '/app/paper.jar', '--nogui'],
    mounts: [{ source: '/host/run', target: '/app', readonly: false }],
    env: { HOME: '/tmp' },
  });
}

// ─── ST-MALICIOUS-CONTAINER-001: Fixture build edilebilirliği ─────────

describe('ST-MALICIOUS-CONTAINER-001: hostile-probe fixture build edilebilirliği', () => {
  test('build.gradle.kts toolchain 25 + paper-api bağımlılığı tanımlar', async () => {
    const buildFile = await readFile(join(FIXTURE_DIR, 'build.gradle.kts'), 'utf8');
    assert.match(buildFile, /JavaLanguageVersion\.of\(25\)/, 'toolchain 25');
    assert.match(buildFile, /io\.papermc\.paper:paper-api/, 'paper-api bağımlılığı');
    assert.match(buildFile, /isReproducibleFileOrder = true/, 'reproducible build');
  });

  test('plugin.yml name/main/api-version hostile probe tanımını taşır', async () => {
    const yaml = await readFile(join(FIXTURE_DIR, 'src', 'main', 'resources', 'plugin.yml'), 'utf8');
    const doc = parseYaml(yaml) as { name?: string; main?: string; 'api-version'?: string };
    assert.equal(doc.name, 'HostileProbe');
    assert.equal(doc.main, 'com.hostile.HostileProbePlugin');
    assert.equal(doc['api-version'], '26.2');
  });

  test('kaynak beş hostile deneyi de içerir (spike planıyla eşleşir)', async () => {
    const source = await readFile(
      join(FIXTURE_DIR, 'src', 'main', 'java', 'com', 'hostile', 'HostileProbePlugin.java'),
      'utf8',
    );
    for (const method of [
      'runTokenSearch',
      'runUnauthorizedRequest',
      'runEvidenceTamper',
      'runFakeEventInjection',
      'runMainThreadBlock',
    ]) {
      assert.ok(source.includes(method), `${method} deneyi kaynakta olmalıdır`);
    }
  });
});

// ─── ST-MALICIOUS-CONTAINER-002: İzolasyon hostile davranışları engeller ─

describe('ST-MALICIOUS-CONTAINER-002: Container izolasyonu hostile davranışları engeller (argüman)', () => {
  test('docker.sock hiçbir argümanda yok (container kaçışı engellenir)', () => {
    const args = hostileRuntimeArgs();
    assert.ok(!args.some((a) => a.includes('docker.sock')), 'docker.sock mount yok');
    assert.ok(!args.some((a) => a.includes('/var/run/docker.sock')), 'unix socket yok');
  });

  test('--privileged yok ve tüm capabilityler düşürülür', () => {
    const args = hostileRuntimeArgs();
    assert.ok(!args.includes('--privileged'), 'privileged yasak');
    const idx = args.indexOf('--cap-drop');
    assert.notEqual(idx, -1);
    assert.equal(args[idx + 1], 'ALL');
  });

  test('ağ default deny (--network none)', () => {
    const args = hostileRuntimeArgs();
    const idx = args.indexOf('--network');
    assert.notEqual(idx, -1);
    assert.equal(args[idx + 1], 'none');
  });

  test('runtime mountu writable, kaynak benzeri ro workspace yine :ro destekler', () => {
    const args = hostileRuntimeArgs();
    assert.ok(args.includes('/host/run:/app'), 'runtime mount writable');
    const roArgs = buildDockerRunArgs({
      containerName: 'c',
      image: 'i',
      command: ['sh'],
      mounts: [{ source: '/host/src', target: '/workspace', readonly: true }],
    });
    assert.ok(roArgs.includes('/host/src:/workspace:ro'), 'ro workspace mount edilebilir');
  });

  test('quota limitleri hostile plugin için de geçerli (pids/disk)', () => {
    const args = hostileRuntimeArgs();
    const pidsIdx = args.indexOf('--pids-limit');
    assert.notEqual(pidsIdx, -1);
    assert.equal(args[pidsIdx + 1], '512', 'pids-limit hostile runtime için de aktif');
    const tmpfs = args[args.indexOf('--tmpfs') + 1] ?? '';
    assert.match(tmpfs, /^\/tmp:size=\d+m$/, 'tmpfs disk limiti tanımlı');
  });
});

// ─── ST-MALICIOUS-CONTAINER-003: Canlı hostile probe container ────────

describe('ST-MALICIOUS-CONTAINER-003: Canlı hostile probe container (Docker gerekir)', () => {
  test('host env secretları container içine sızmaz', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const probe = new ContainerBackend({ image: 'alpine:latest', maxMemoryMb: 256 });
    const result = await probe.run({
      workDir: '/',
      env: { ONLY_ALLOWED: 'yes' },
      command: ['sh', '-c', 'env | grep -E "^(AWS_|GITHUB_|VAULT_|API_KEY)" || echo NO_HOST_SECRET'],
      timeoutMs: 15_000,
    });
    assert.ok(result.stdout.includes('NO_HOST_SECRET'), `host secret sızdı: ${result.stdout.trim().slice(0, 200)}`);
  });

  test('docker.sock container içinde yok', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const probe = new ContainerBackend({ image: 'alpine:latest', maxMemoryMb: 256 });
    const result = await probe.run({
      workDir: '/',
      command: ['sh', '-c', '[ -e /var/run/docker.sock ] && echo SOCKET_PRESENT || echo NO_SOCKET'],
      timeoutMs: 15_000,
    });
    assert.ok(result.stdout.includes('NO_SOCKET'), 'docker.sock erişilebilir (kritik)');
  });

  test('ağ erişimi kapalı (--network none)', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const probe = new ContainerBackend({ image: 'alpine:latest', maxMemoryMb: 256 });
    const result = await probe.run({
      workDir: '/',
      command: ['sh', '-c', 'ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1 && echo NET_OK || echo NET_BLOCKED'],
      timeoutMs: 15_000,
    });
    assert.ok(result.stdout.includes('NET_BLOCKED'), 'ağ erişimi açık (kritik)');
  });

  test('ro workspace mountuna yazılamaz', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const roDir = await mkdtemp(join(tmpdir(), 'mcpdev-hostile-ro-'));
    try {
      const probe = new ContainerBackend({ image: 'alpine:latest', maxMemoryMb: 256 });
      const result = await probe.run({
        workDir: '/',
        mounts: [{ source: roDir, target: '/workspace', readonly: true }],
        command: ['sh', '-c', 'echo x > /workspace/try.txt 2>/dev/null && echo WRITE_OK || echo WRITE_BLOCKED'],
        timeoutMs: 15_000,
      });
      assert.ok(result.stdout.includes('WRITE_BLOCKED'), 'ro mounta yazılabildi (kritik)');
    } finally {
      await rm(roDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('tmpfs disposable olarak yazılabilir (beklenen davranış)', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const probe = new ContainerBackend({ image: 'alpine:latest', maxMemoryMb: 256 });
    const result = await probe.run({
      workDir: '/',
      command: ['sh', '-c', 'echo x > /tmp/w.txt 2>/dev/null && echo TMP_OK || echo TMP_BLOCKED'],
      timeoutMs: 15_000,
    });
    assert.ok(result.stdout.includes('TMP_OK'), 'tmpfs yazılamadı');
  });

  test('disk quota: tmpfs 100MB limiti disk doldurmayı engeller', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const probe = new ContainerBackend({ image: 'alpine:latest', maxMemoryMb: 256 });
    const result = await probe.run({
      workDir: '/',
      command: ['sh', '-c', 'dd if=/dev/zero of=/tmp/big bs=1M count=200 2>/dev/null && echo DISK_OK || echo DISK_BLOCKED'],
      timeoutMs: 30_000,
    });
    assert.ok(
      result.stdout.includes('DISK_BLOCKED') || result.exitCode !== 0,
      `disk limiti yok (exit ${result.exitCode})`,
    );
  });

  test('pid quota: pids-limit 512 process bombasını engeller', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const probe = new ContainerBackend({ image: 'alpine:latest', maxMemoryMb: 256, maxPids: 512 });
    const result = await probe.run({
      workDir: '/',
      command: ['sh', '-c', 'i=0; while [ $i -lt 1500 ]; do sleep 30 & i=$((i+1)); done; sleep 1; echo PIDS_OK || echo PIDS_BLOCKED'],
      timeoutMs: 30_000,
    });
    assert.ok(
      result.exitCode !== 0 || !result.stdout.includes('PIDS_OK'),
      `1500 process spawn edilebildi (pids-limit yok)`,
    );
  });
});
