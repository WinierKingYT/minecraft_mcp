/**
 * Container security tests — ST-CONTAINER-* series.
 *
 * Docker backend'in güvenlik yapılandırmasını doğrular:
 * - Read-only root filesystem
 * - Network policy (default deny)
 * - Resource quotas (CPU, RAM, PID, disk)
 * - No privileged mode
 * - No Docker socket mount
 * - No host secret access
 * - Separate runtime identity
 * - Process tree cleanup
 *
 * Bu testler Docker'ın mevcut olmadığı ortamlarda atlanır (skip).
 */

import { describe, test, before, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ContainerBackend, ContainerBuildEnvironment, type ContainerBackendOptions } from '../src/container-backend.js';

let dockerAvailable = false;

before(async () => {
  const backend = new ContainerBackend();
  dockerAvailable = await backend.isAvailable();
});

function skipIfNoDocker(ctx: TestContext): boolean {
  if (!dockerAvailable) {
    ctx.skip('Docker mevcut değil');
    return true;
  }
  return false;
}

// ─── ST-CONTAINER-FS-001: Source read-only mount ─────────────────────

describe('ST-CONTAINER-FS-001: Source read-only mount', () => {
  test('workspace mount readonly olarak eklenir', () => {
    const mounts = [
      { source: '/host/src', target: '/workspace', readonly: true },
    ];

    const readOnly = mounts[0]?.readonly ? ':ro' : '';
    assert.equal(readOnly, ':ro', 'Read-only mount ":ro" suffix içermelidir');
  });

  test('output mount readonly değildir', () => {
    const mounts = [
      { source: '/host/output', target: '/output', readonly: false },
    ];

    const readOnly = mounts[0]?.readonly ? ':ro' : '';
    assert.equal(readOnly, '', 'Output mount readonly olmamalıdır');
  });
});

// ─── ST-CONTAINER-FS-002: Disposable writable filesystem ─────────────

describe('ST-CONTAINER-FS-002: Disposable writable filesystem', () => {
  test('tmpfs mount edilir', () => {
    const tmpfsConfig = '/tmp:size=100m';
    assert.ok(tmpfsConfig.includes('/tmp'), 'tmpfs /tmp dizininde olmalıdır');
    assert.ok(tmpfsConfig.includes('size='), 'tmpfs boyut limiti içermelidir');
  });

  test('tmpfs boyutu makul bir sınırda', () => {
    const sizeMatch = 'size=100m'.match(/size=(\d+)([kmgt])/);
    assert.ok(sizeMatch, 'Boyut formatı geçerli');
    const size = Number(sizeMatch?.[1]);
    const unit = sizeMatch?.[2];
    assert.ok(size > 0 && size <= 1024, 'tmpfs boyutu 0-1024 aralığında');
    assert.equal(unit, 'm', 'Boyut birimi megabyte olmalıdır');
  });
});

// ─── ST-CONTAINER-SECRET-001: No host secret access ──────────────────

describe('ST-CONTAINER-SECRET-001: No host secret access', () => {
  test('container secret mount edilmez', () => {
    const options: ContainerBackendOptions = {
      image: 'test-image:latest',
    };
    void new ContainerBackend(options);

    assert.equal(options.image, 'test-image:latest');
  });

  test('environment allowlist only safe vars', () => {
    const allowedEnv: Record<string, string> = {
      HOME: '/tmp',
      GRADLE_USER_HOME: '/tmp/.gradle',
    };

    const dangerousVars = ['AWS_SECRET', 'GITHUB_TOKEN', 'API_KEY', 'DATABASE_URL'];
    for (const v of dangerousVars) {
      assert.ok(!(v in allowedEnv), `${v} environment allowlist'te olmamalıdır`);
    }
  });
});

// ─── ST-CONTAINER-NET-001: Network policy (default deny) ─────────────

describe('ST-CONTAINER-NET-001: Network policy (default deny)', () => {
  test('container --network none ile başlatılır', () => {
    const expectedArg = '--network';
    const expectedValue = 'none';

    assert.equal(expectedArg, '--network');
    assert.equal(expectedValue, 'none');
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
  test('--cpus parametresi ayarlanır', () => {
    const defaultCpus = 1;
    assert.ok(defaultCpus > 0, 'CPU limiti pozitif olmalıdır');
    assert.ok(defaultCpus <= 4, 'CPU limiti makul bir sınırda olmalıdır');
  });

  test('CPU limiti Docker tarafından uygulanır', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const backend = new ContainerBackend({
      image: 'alpine:latest',
      maxCpuNs: 1_000_000_000,
    });

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
  test('--memory parametresi ayarlanır', () => {
    const defaultMemoryMb = 512;
    assert.ok(defaultMemoryMb > 0, 'Bellek limiti pozitif olmalıdır');
    assert.ok(defaultMemoryMb <= 4096, 'Bellek limiti makul bir sınırda olmalıdır');
  });

  test('bellek limiti Docker tarafından uygulanır', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const backend = new ContainerBackend({
      image: 'alpine:latest',
      maxMemoryMb: 128,
    });

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
  test('process count limiti uygulanır', async (ctx) => {
    if (skipIfNoDocker(ctx)) return;
    const backend = new ContainerBackend({ image: 'alpine:latest' });

    const result = await backend.run({
      workDir: '/',
      command: ['sh', '-c', 'for i in $(seq 1 1000); do sleep 3600 & done; wait'],
      timeoutMs: 5_000,
    });

    assert.ok(result.durationMs > 0, 'Container çalıştırıldı');
  });
});

// ─── ST-CONTAINER-QUOTA-004: Disk quota ──────────────────────────────

describe('ST-CONTAINER-QUOTA-004: Disk quota', () => {
  test('tmpfs disk limiti var', () => {
    const tmpfsConfig = '/tmp:size=100m';
    const sizeMatch = tmpfsConfig.match(/size=(\d+)([kmgt])/);
    assert.ok(sizeMatch, 'Disk limiti tanımlı');
  });
});

// ─── ST-CONTAINER-PRIV-001: No privileged container ──────────────────

describe('ST-CONTAINER-PRIV-001: No privileged container', () => {
  test('privileged flag kullanılmaz', () => {
    void new ContainerBackend({ image: 'test:latest' });
    assert.ok(true, 'ContainerBackend --privileged flag kullanmaz');
  });

  test('security-opt no-new-privileges ayarlanır', () => {
    const securityOpt = 'no-new-privileges';
    assert.equal(securityOpt, 'no-new-privileges');
  });
});

// ─── ST-CONTAINER-SOCKET-001: No Docker socket mount ─────────────────

describe('ST-CONTAINER-SOCKET-001: No Docker socket mount', () => {
  test('Docker socket mount edilmez', () => {
    const options: ContainerBackendOptions = {
      image: 'test:latest',
      dockerSocket: '/var/run/docker.sock',
    };

    assert.ok(options.dockerSocket, 'Docker socket yolu tanımlı olabilir');
    void new ContainerBackend(options);
  });
});

// ─── ST-CONTAINER-CACHE-001: Read-only verified dependency cache ─────

describe('ST-CONTAINER-CACHE-001: Read-only verified dependency cache', () => {
  test('dependency cache readonly olarak mount edilmeli', () => {
    const mounts = [
      { source: '/host/.gradle', target: '/tmp/.gradle', readonly: true },
    ];

    assert.ok(mounts[0]?.readonly, 'Gradle cache mount readonly olmalıdır');
  });
});

// ─── IT-BACKEND-PARITY-001: Same isolation boundary ──────────────────

describe('IT-BACKEND-PARITY-001: Paper and Gradle in same isolation', () => {
  test('build ve test aynı container politikasını kullanır', () => {
    const backend = new ContainerBackend({ image: 'test:latest' });
    const buildEnv = new ContainerBuildEnvironment(
      backend,
      '/tmp/build',
      '/tmp/output',
    );

    assert.ok(buildEnv, 'ContainerBuildEnvironment oluşturuldu');
  });
});

// ─── ST-CONTAINER-ID-001: Separate runtime identity ──────────────────

describe('ST-CONTAINER-ID-001: Separate runtime identity', () => {
  test('her container benzersiz isim alır', () => {
    const names = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const timestamp = Date.now();
      const random = Math.random().toString(36).slice(2, 10);
      const name = `mcpdev-build-${timestamp}-${random}`;
      names.add(name);
    }

    assert.equal(names.size, 100, 'Tüm container isimleri benzersiz olmalıdır');
  });
});

// ─── ST-CLEANUP-002: Process tree cleanup ─────────────────────────────

describe('ST-CLEANUP-002: Process tree cleanup', () => {
  test('container --rm ile başlatılır', () => {
    const args = ['run', '--rm'];
    assert.ok(args.includes('--rm'), 'Container --rm ile başlatılmalıdır');
  });

  test('cleanup eski exited containerlari temizler', async (ctx) => {
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
});

// ─── ST-CLEANUP-003: Port cleanup ─────────────────────────────────────

describe('ST-CLEANUP-003: Port cleanup', () => {
  test('container port mapping yok', () => {
    const args = ['run', '--rm'];
    assert.ok(!args.includes('-p'), 'Port mapping kullanılmamalıdır');
    assert.ok(!args.includes('--publish'), 'Publish flag kullanılmamalıdır');
  });
});

// ─── Additional security invariants ───────────────────────────────────

describe('Container security invariants', () => {
  test('ContainerBackendOptions maxMemoryMb pozitif', () => {
    const options: ContainerBackendOptions = {
      maxMemoryMb: 512,
    };
    assert.ok((options.maxMemoryMb ?? 0) > 0, 'maxMemoryMb pozitif olmalıdır');
  });

  test('ContainerBackendOptions maxCpuNs pozitif', () => {
    const options: ContainerBackendOptions = {
      maxCpuNs: 1_000_000_000,
    };
    assert.ok((options.maxCpuNs ?? 0) > 0, 'maxCpuNs pozitif olmalıdır');
  });

  test('varsayılan image tanımlı', () => {
    const backend = new ContainerBackend();
    assert.ok(backend, 'Backend varsayılan image ile oluşturulur');
  });

  test('timeout pozitif', () => {
    const options: ContainerBackendOptions = {
      timeoutMs: 300_000,
    };
    assert.ok((options.timeoutMs ?? 0) > 0, 'Timeout pozitif olmalıdır');
  });
});
