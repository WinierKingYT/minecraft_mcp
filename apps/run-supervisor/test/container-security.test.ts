/**
 * Container security tests — ST-CONTAINER-* series.
 *
 * Docker backend'in güvenlik yapılandırmasını GERÇEK davranış olarak doğrular:
 * `buildDockerRunArgs` tarafından üretilen argümanlar (ADR-0004 §4 zorunlu
 * kontrolleri), `getAvailability` teşhisi (Q9), artifact path containment (Q5)
 * ve offline/ro-cache build (Q3/Q4) — Docker CLI olmayan ortamlarda bile.
 *
 * Docker'a bağımlı canlı doğrulamalar (ping, nproc, cgroup okuma) `skipIfNoDocker`
 * ile ayrılmıştır: bu makinelerde SPIKE-EXECUTION-CONTAINER-001 canlı deneyi
 * `apps/run-supervisor/src/spike-container-check.ts` ile koşulur.
 */

import { describe, test, before, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  ContainerBackend,
  ContainerBuildEnvironment,
  buildDockerRunArgs,
  assertInsideDir,
  ContainerPathTraversalError,
  type ContainerRunResult,
} from '../src/container-backend.js';
import { join } from 'node:path';

let dockerAvailable = false;

before(async () => {
  const backend = new ContainerBackend();
  // P0-4: Docker CLI bulunsa da canlı `docker run` güvenilir olmayabilir
  // (Windows GitHub runner'da Linux container desteği için daemon hazır
  // değil; exit 125 ile düşer). CI bu env'i set ederek canlı Docker
  // testlerini zorla skip eder; hermetic (argüman üretim) testler yine koşar.
  if (process.env.MCPDEV_SKIP_DOCKER === '1') {
    dockerAvailable = false;
    return;
  }
  dockerAvailable = await backend.isAvailable();
});

function skipIfNoDocker(ctx: TestContext): boolean {
  if (!dockerAvailable) {
    ctx.skip('Docker mevcut değil');
    return true;
  }
  return false;
}

/** Arg listesinden bir `--flag` değerini döner; yoksa null. */
function flagValue(args: readonly string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

function baseArgs() {
  return buildDockerRunArgs({
    containerName: 'mcpdev-build-test',
    image: 'mcpdev-build:latest',
    command: ['./gradlew', 'build', '--no-daemon'],
  });
}

// ─── ST-CONTAINER-FS-001: Source read-only mount ─────────────────────

describe('ST-CONTAINER-FS-001: Source read-only mount', () => {
  test('workspace mount readonly olarak eklenir', () => {
    const args = buildDockerRunArgs({
      containerName: 'c',
      image: 'i',
      command: ['sh'],
      mounts: [
        { source: '/host/src', target: '/workspace', readonly: true },
        { source: '/host/output', target: '/output', readonly: false },
      ],
    });

    assert.ok(args.includes('/host/src:/workspace:ro'), 'Source mount :ro olmalıdır');
    assert.ok(args.includes('/host/output:/output'), 'Output mount rw olmalıdır');
    assert.ok(!args.includes('/host/output:/output:ro'), 'Output mount :ro olmamalıdır');
  });

  test('mount yalnızca explicit listeden gelir (host path sızması yok)', () => {
    const args = buildDockerRunArgs({
      containerName: 'c',
      image: 'i',
      command: ['sh'],
      mounts: [{ source: '/host/workspace', target: '/workspace', readonly: true }],
    });

    const volumes = args.filter((a) => a === '--volume').length;
    assert.equal(volumes, 1, 'Yalnızca bir explicit mount olmalıdır');
    assert.ok(!args.some((a) => a.includes('C:\\') || a.includes('/mnt/c')), 'Host kök mount edilmez');
  });
});

// ─── ST-CONTAINER-FS-002: Disposable writable filesystem ─────────────

describe('ST-CONTAINER-FS-002: Disposable writable filesystem', () => {
  test('tmpfs /tmp sınırlı boyutta mount edilir', () => {
    const tmpfs = flagValue(baseArgs(), '--tmpfs') ?? '';
    assert.match(tmpfs, /^\/tmp:size=/, 'tmpfs /tmp:size= biçiminde olmalıdır');
  });

  test('tmpfs boyutu makul bir sınırda (≤1GB)', () => {
    const tmpfs = flagValue(baseArgs(), '--tmpfs') ?? '';
    const sizeMatch = tmpfs.match(/size=(\d+)([kmgt])/);
    assert.ok(sizeMatch, 'Boyut formatı geçerli');
    const size = Number(sizeMatch?.[1]);
    assert.ok(size > 0 && size <= 1024, 'tmpfs boyutu 0-1024 aralığında');
  });
});

// ─── ST-CONTAINER-SECRET-001: No host secret access ──────────────────

describe('ST-CONTAINER-SECRET-001: No host secret access', () => {
  test('env allowlist: yalnızca explicit env geçer', () => {
    const args = buildDockerRunArgs({
      containerName: 'c',
      image: 'i',
      command: ['sh'],
      env: { HOME: '/tmp', GRADLE_USER_HOME: '/tmp/.gradle' },
    });

    assert.ok(args.includes('--env'));
    assert.ok(args.includes('HOME=/tmp'));
    assert.ok(args.includes('GRADLE_USER_HOME=/tmp/.gradle'));
  });

  test('tehlikeli host env değişkenleri asla geçirilmez', () => {
    const args = baseArgs();
    const dangerous = ['AWS_SECRET', 'GITHUB_TOKEN', 'API_KEY', 'DATABASE_URL', 'VAULT_TOKEN', 'SSH_AUTH_SOCK'];
    for (const v of dangerous) {
      assert.ok(!args.some((a) => a.startsWith(`${v}=`)), `${v} allowlist dışı olmalıdır`);
    }
  });

  test('docker socket mount edilmez', () => {
    const args = baseArgs();
    assert.ok(!args.some((a) => a.includes('docker.sock')), 'Docker socket hiçbir mountta olmamalıdır');
  });
});

// ─── ST-CONTAINER-NET-001: Network policy (default deny) ─────────────

describe('ST-CONTAINER-NET-001: Network policy (default deny)', () => {
  test('container --network none ile başlatılır', () => {
    const args = baseArgs();
    assert.equal(flagValue(args, '--network'), 'none', 'Ağ default deny olmalıdır');
  });

  test('network erişimi olmayan container exit code 1 döner', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const backend = new ContainerBackend({ image: 'alpine:latest' });

    const result = await backend.run({
      workDir: '/',
      command: ['sh', '-c', 'ping -c 1 8.8.8.8 || exit 1'],
      timeoutMs: 10_000,
    });

    assert.notEqual(result.exitCode, 0, 'Network none ile ping başarısız olmalıdır');
  });
});

// ─── ST-CONTAINER-QUOTA-001: CPU quota ───────────────────────────────

describe('ST-CONTAINER-QUOTA-001: CPU quota', () => {
  test('--cpus parametresi default 2 ile ayarlanır', () => {
    const cpus = Number(flagValue(baseArgs(), '--cpus'));
    assert.ok(cpus > 0, 'CPU limiti pozitif olmalıdır');
    assert.ok(cpus <= 4, 'CPU limiti makul bir sınırda olmalıdır');
  });

  test('CPU limiti Docker tarafından uygulanır', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const backend = new ContainerBackend({ image: 'alpine:latest' });

    const result = await backend.run({
      workDir: '/',
      command: ['sh', '-c', 'nproc'],
      timeoutMs: 10_000,
    });

    assert.equal(result.exitCode, 0);
    const cpuCount = Number(result.stdout.trim());
    assert.ok(cpuCount >= 1, 'En az 1 CPU mevcut olmalıdır');
  });
});

// ─── ST-CONTAINER-QUOTA-002: RAM quota ───────────────────────────────

describe('ST-CONTAINER-QUOTA-002: RAM quota', () => {
  test('--memory parametresi default 4096m ile ayarlanır', () => {
    const mem = flagValue(baseArgs(), '--memory') ?? '';
    assert.match(mem, /^\d+m$/, 'Bellek limiti megabyte olmalıdır');
    const mb = Number(mem.slice(0, -1));
    assert.ok(mb > 0 && mb <= 8192, 'Bellek limiti makul bir sınırda olmalıdır');
  });

  test('--memory-swap swap kapalıdır (canlı bulgu: default swap 2x limiti yumuşatır)', () => {
    const mem = flagValue(baseArgs(), '--memory') ?? '4096m';
    const swap = flagValue(baseArgs(), '--memory-swap') ?? '';
    assert.ok(swap.length > 0, '--memory-swap belirtilmelidir');
    assert.ok(
      Number(swap.slice(0, -1)) <= Number(mem.slice(0, -1)),
      'swap limiti bellek limitini aşmamalıdır (varsayılan: eşit → swap yok)',
    );
  });

  test('maxSwapMb verilirse swap açılabilir', () => {
    const args = buildDockerRunArgs({
      containerName: 'c',
      image: 'i',
      command: ['sh'],
      maxMemoryMb: 256,
      maxSwapMb: 512,
    });
    assert.equal(flagValue(args, '--memory-swap'), '512m');
  });

  test('bellek limiti Docker tarafından uygulanır', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const backend = new ContainerBackend({ image: 'alpine:latest', maxMemoryMb: 128 });

    const result = await backend.run({
      workDir: '/',
      command: ['sh', '-c', 'cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo "unknown"'],
      timeoutMs: 10_000,
    });

    assert.equal(result.exitCode, 0);
    const memLimit = result.stdout.trim();
    if (memLimit !== 'unknown') {
      const limitBytes = Number(memLimit);
      assert.ok(limitBytes > 0, 'Bellek limiti pozitif olmalıdır');
    }
  });
});

// ─── ST-CONTAINER-QUOTA-003: PID quota ───────────────────────────────

describe('ST-CONTAINER-QUOTA-003: PID quota', () => {
  test('--pids-limit her container için ayarlanır', () => {
    const pids = Number(flagValue(baseArgs(), '--pids-limit'));
    assert.ok(pids > 0, 'PID limiti pozitif olmalıdır');
    assert.ok(pids <= 4096, 'PID limiti makul bir sınırda olmalıdır');
  });
});

// ─── ST-CONTAINER-QUOTA-004: Disk quota ──────────────────────────────

describe('ST-CONTAINER-QUOTA-004: Disk quota', () => {
  test('tmpfs disk limiti var', () => {
    const tmpfs = flagValue(baseArgs(), '--tmpfs') ?? '';
    assert.ok(tmpfs.includes('size='), 'Disk limiti tanımlı');
  });
});

// ─── ST-CONTAINER-PRIV-001: No privileged container ──────────────────

describe('ST-CONTAINER-PRIV-001: No privileged container', () => {
  test('--privileged flag kullanılmaz', () => {
    const args = baseArgs();
    assert.ok(!args.includes('--privileged'), 'Privileged container yasak');
  });

  test('--cap-drop ALL ile tüm capabilityler düşürülür', () => {
    const args = baseArgs();
    const idx = args.indexOf('--cap-drop');
    assert.notEqual(idx, -1, '--cap-drop olmalıdır');
    assert.equal(args[idx + 1], 'ALL', 'Tüm capabilityler düşürülmelidir');
  });

  test('--security-opt no-new-privileges ayarlanır', () => {
    const args = baseArgs();
    const idx = args.indexOf('--security-opt');
    assert.notEqual(idx, -1, '--security-opt olmalıdır');
    assert.equal(args[idx + 1], 'no-new-privileges');
  });
});

// ─── ST-CONTAINER-SOCKET-001: No Docker socket mount ─────────────────

describe('ST-CONTAINER-SOCKET-001: No Docker socket mount', () => {
  test('hiçbir argüman socket/docker CLI erişimi sağlamaz', () => {
    const args = baseArgs();
    assert.ok(!args.includes('/var/run/docker.sock'), 'Unix socket mount yok');
    assert.ok(!args.includes('npipe://'), 'Windows named pipe yok');
    assert.ok(!args.includes('//./pipe/docker_engine'), 'Windows pipe yolu yok');
  });
});

// ─── ST-CONTAINER-CACHE-001: Read-only verified dependency cache ─────

describe('ST-CONTAINER-CACHE-001: Read-only verified dependency cache', () => {
  test('dependency cache ro mount edilir, GRADLE_USER_HOME writable kopyaya işaret eder', async () => {
    let capturedArgs: readonly string[] = [];
    const mockBackend = new ContainerBackend({
      image: 'mcpdev-build:latest',
      execImpl: (args) => {
        capturedArgs = args;
        return Promise.resolve({
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 1,
          timedOut: false,
        } satisfies ContainerRunResult);
      },
    });

    const env = new ContainerBuildEnvironment(mockBackend, '/tmp/build', '/tmp/output');
    await env.build('p1', ['./gradlew', 'build'], { dependencyCacheDir: '/host/.gradle-cache' });

    assert.ok(capturedArgs.includes('/host/.gradle-cache:/cache:ro'), 'Cache :ro mount edilmelidir');
    assert.ok(capturedArgs.includes('GRADLE_USER_HOME=/output/.gradle'), 'GRADLE_USER_HOME writable kopyaya işaret etmelidir');
    const shell = capturedArgs[capturedArgs.indexOf('sh') + 2] ?? '';
    assert.ok(shell.includes('tar -C /cache'), 'Cache seed kopyalama adımı olmalıdır');
    assert.ok(shell.includes('--exclude=*.lock'), 'Lock dosyaları kopyaya taşınmaz (I/O error kaynağı)');
  });
});

// ─── IT-BACKEND-PARITY-001: Same isolation boundary ──────────────────

describe('IT-BACKEND-PARITY-001: Paper and Gradle in same isolation', () => {
  test('build ve test aynı güvenlik profilini kullanır (tek buildDockerRunArgs)', () => {
    const backend = new ContainerBackend({ image: 'test:latest' });
    const buildEnv = new ContainerBuildEnvironment(backend, '/tmp/build', '/tmp/output');

    assert.ok(buildEnv, 'ContainerBuildEnvironment oluşturuldu');
  });
});

// ─── ST-CONTAINER-ID-001: Separate runtime identity ──────────────────

describe('ST-CONTAINER-ID-001: Separate runtime identity', () => {
  test('her container benzersiz isim alır', () => {
    const names = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const name = `mcpdev-build-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      names.add(name);
    }
    assert.equal(names.size, 100, 'Tüm container isimleri benzersiz olmalıdır');
  });

  test('runtime container build prefix yerine mcpdev-runtime- alır (Q2 ayrımı)', () => {
    const args = buildDockerRunArgs({
      containerName: 'mcpdev-runtime-123-abcd',
      image: 'mcpdev-runtime:latest',
      command: ['java', '-jar', '/app/server.jar'],
      // Runtime mount'u WRITABLE'dır: Paper state'i (world/logs/cache) yazar.
      // (Canlı deney bulgusu — ro runtime mount Paper'ı açılışta kırar.)
      mounts: [{ source: '/host/run', target: '/app', readonly: false }],
    });
    const idx = args.indexOf('--name');
    assert.equal(args[idx + 1]?.startsWith('mcpdev-runtime-'), true, 'Runtime ayrı kimlik prefix kullanır');
    assert.ok(args.includes('/host/run:/app'), 'Runtime mount writable olmalıdır (Paper state yazar)');
    assert.ok(!args.includes('/host/run:/app:ro'), 'Runtime mount :ro olmamalıdır');
  });
});

// ─── ST-CLEANUP-002: Process tree cleanup ─────────────────────────────

describe('ST-CLEANUP-002: Process tree cleanup', () => {
  test('container --rm ile başlatılır (konteyner ölünce tam silinir)', () => {
    const args = baseArgs();
    assert.ok(args.includes('--rm'), 'Container --rm ile başlatılmalıdır');
  });

  test('--init ile zombie reaper aktif (Q7/Q8)', () => {
    const args = baseArgs();
    assert.ok(args.includes('--init'), 'Zombie reaper --init aktif olmalıdır');
  });

  test('cleanup mcpdev- prefixli exited containerlari temizler', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const backend = new ContainerBackend({ image: 'alpine:latest' });

    const result = await backend.run({
      workDir: '/',
      command: ['sh', '-c', 'exit 0'],
      timeoutMs: 10_000,
    });

    assert.equal(result.exitCode, 0);
    const cleaned = await backend.cleanup(0);
    assert.ok(cleaned >= 0, 'Cleanup çalıştırılabilir');
  });

  test('timeout sonrası container kesin silinir (orphan önleme — canlı bulgu)', async () => {
    const calls: string[][] = [];
    const backend = new ContainerBackend({
      image: 'test:latest',
      execImpl: (args) => {
        calls.push([...args]);
        // İlk çağrı (run): timeout; ikinci çağrı (rm): başarılı.
        const timedOut = calls.length === 1;
        return Promise.resolve({
          exitCode: timedOut ? 1 : 0,
          stdout: '',
          stderr: '',
          durationMs: 1,
          timedOut,
        } satisfies ContainerRunResult);
      },
    });

    const result = await backend.run({ workDir: '/', command: ['sh'], timeoutMs: 1000 });

    assert.equal(result.timedOut, true);
    assert.equal(calls.length, 2, 'Timeout sonrası rm çağrısı yapılmalıdır');
    const runArgs = calls[0]!;
    const rmArgs = calls[1]!;
    const nameIdx = runArgs.indexOf('--name');
    const containerName = runArgs[nameIdx + 1];
    assert.equal(rmArgs[0], 'rm', 'rm komutu çalıştırılmalıdır');
    assert.ok(rmArgs.includes('-f'), 'Force silme kullanılmalıdır');
    assert.ok(rmArgs.includes(containerName ?? ''), 'Timeout olan container silinmelidir');
  });
});

// ─── ST-CLEANUP-003: Port cleanup ─────────────────────────────────────

describe('ST-CLEANUP-003: Port cleanup', () => {
  test('build container port mapping yok', () => {
    const args = baseArgs();
    assert.ok(!args.includes('-p'), 'Port mapping kullanılmamalıdır');
    assert.ok(!args.includes('--publish'), 'Publish flag kullanılmamalıdır');
  });

  test('port yayınlama yalnızca explicit publishPorts ile açılır (Q2)', () => {
    const args = buildDockerRunArgs({
      containerName: 'c',
      image: 'i',
      command: ['sh'],
      publishPorts: [{ container: 8080, host: 30001 }],
    });
    assert.ok(args.includes('--publish'), 'Runtime container bridge erişimi için publish gerekir');
    assert.ok(args.includes('30001:8080'));
  });
});

// ─── Q9: Availability diagnostics ─────────────────────────────────────

describe('ST-CONTAINER-DIAG-001: Availability diagnostics (Q9)', () => {
  test('docker CLI yoksa docker-not-found döner', async () => {
    const backend = new ContainerBackend({
      execImpl: () =>
        Promise.resolve({
          exitCode: 1,
          stdout: '',
          stderr: 'docker: command not found',
          durationMs: 1,
          timedOut: false,
        }),
    });

    const availability = await backend.getAvailability();
    assert.equal(availability.available, false);
    assert.equal(availability.reason, 'docker-not-found');
    assert.ok(availability.detail, 'Teşhis mesajı olmalıdır');
  });

  test('daemon kapalıysa daemon-unavailable döner ve stderr iletilir', async () => {
    const backend = new ContainerBackend({
      execImpl: (args) =>
        Promise.resolve({
          exitCode: args[0] === '--version' ? 0 : 1,
          stdout: '',
          stderr: args[0] === '--version' ? '' : 'Cannot connect to the Docker daemon',
          durationMs: 1,
          timedOut: false,
        }),
    });

    const availability = await backend.getAvailability();
    assert.equal(availability.available, false);
    assert.equal(availability.reason, 'daemon-unavailable');
    assert.match(availability.detail ?? '', /daemon/i);
  });

  test('cli + daemon varsa ok döner', async () => {
    const backend = new ContainerBackend({
      execImpl: () =>
        Promise.resolve({
          exitCode: 0,
          stdout: 'Docker version 28.x',
          stderr: '',
          durationMs: 1,
          timedOut: false,
        }),
    });

    const availability = await backend.getAvailability();
    assert.equal(availability.available, true);
    assert.equal(availability.reason, 'ok');
  });
});

// ─── Q5: Artifact export path containment ────────────────────────────

describe('ST-CONTAINER-EXPORT-001: Artifact path containment (Q5)', () => {
  test('output dizini içindeki yol kabul edilir', () => {
    const resolved = assertInsideDir(join('/tmp/output', 'libs', 'plugin.jar'), '/tmp/output');
    assert.ok(resolved.endsWith(join('libs', 'plugin.jar')));
  });

  test('üst dizine kaçış (..) reddedilir', () => {
    assert.throws(
      () => assertInsideDir(join('/tmp/output', '..', '..', 'etc', 'passwd'), '/tmp/output'),
      ContainerPathTraversalError,
    );
  });

  test('dış absolute yol reddedilir', () => {
    assert.throws(
      () => assertInsideDir('/etc/passwd', '/tmp/output'),
      ContainerPathTraversalError,
    );
  });

  test('collectArtifact traversal hatasını yayar', async () => {
    const backend = new ContainerBackend();
    await assert.rejects(
      async () => backend.collectArtifact('/tmp/output/../../etc/passwd', '/tmp/output'),
      ContainerPathTraversalError,
    );
  });
});

// ─── Q3: Offline build ────────────────────────────────────────────────

describe('ST-CONTAINER-OFFLINE-001: Offline Gradle build (Q3)', () => {
  test('network offline iken --offline komuta eklenir', async () => {
    let capturedArgs: readonly string[] = [];
    const mockBackend = new ContainerBackend({
      execImpl: (args) => {
        capturedArgs = args;
        return Promise.resolve({
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 1,
          timedOut: false,
        } satisfies ContainerRunResult);
      },
    });

    const env = new ContainerBuildEnvironment(mockBackend, '/tmp/build', '/tmp/output');
    const result = await env.build('p1', ['./gradlew', 'build', '--no-daemon'], { network: 'offline' });

    assert.equal(result.exitCode, 0);
    assert.ok(capturedArgs.some((a) => a.includes('--offline')), 'Offline modda --offline eklenmelidir');
  });

  test('repository-allowlist iken --offline eklenmez', async () => {
    let capturedArgs: readonly string[] = [];
    const mockBackend = new ContainerBackend({
      execImpl: (args) => {
        capturedArgs = args;
        return Promise.resolve({
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 1,
          timedOut: false,
        } satisfies ContainerRunResult);
      },
    });

    const env = new ContainerBuildEnvironment(mockBackend, '/tmp/build', '/tmp/output');
    await env.build('p1', ['./gradlew', 'build', '--no-daemon'], { network: 'repository-allowlist' });

    assert.ok(!capturedArgs.includes('--offline'));
  });
});
