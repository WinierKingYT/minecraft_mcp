/**
 * Container Backend — Docker ile izole build/test ortamı.
 *
 * Plugin'leri izole Docker konteynerlerinde derler ve test eder.
 * Güvenlik: root erişimi yok, network kısıtlı, resource limitleri.
 *
 * SPIKE-EXECUTION-CONTAINER-001 karşılığı olan zorunlu kontroller
 * (ADR-0004 §4) `buildDockerRunArgs` içinde tek yerde toplanır ve
 * `container-security.test.ts` tarafından gerçek davranış olarak doğrulanır:
 * read-only source mount · disposable writable fs · host secret yok ·
 * network default deny · CPU/RAM/PID/disk quota · ayrı runtime identity ·
 * process tree cleanup · no privileged · no Docker socket · ro verified
 * cache · explicit artifact export (path containment).
 */

import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';

export interface ContainerBackendOptions {
  /** Docker socket yolu. */
  readonly dockerSocket?: string;
  /** Kullanılacak image adı. */
  readonly image?: string;
  /** Container timeout (ms). */
  readonly timeoutMs?: number;
  /** Maksimum bellek (MB). */
  readonly maxMemoryMb?: number;
  /** Maksimum bellek+swap (MB). Varsayılan: maxMemoryMb — swap KAPALI (canlı bulgu). */
  readonly maxSwapMb?: number;
  /** Maksimum CPU sayısı (--cpus). */
  readonly cpus?: number;
  /** Maksimum PID sayısı (--pids-limit). */
  readonly maxPids?: number;
  /** Zombie reaper olarak init process'i başlat (--init). */
  readonly useInit?: boolean;
  /** Test amaçlı exec override'ı (Docker olmayan ortamda davranış doğrulaması). */
  readonly execImpl?: (args: readonly string[], timeoutMs?: number) => Promise<ContainerRunResult>;
  /** Logger. */
  readonly log?: (level: string, event: string, fields: Record<string, unknown>) => void;
}

export interface ContainerRunOptions {
  /** Çalışma dizini. */
  readonly workDir: string;
  /** Mount edilecek dizinler. */
  readonly mounts?: ReadonlyArray<{ source: string; target: string; readonly?: boolean }>;
  /** Environment değişkenleri — host env ASLA geçirilmez, yalnızca bu allowlist. */
  readonly env?: Record<string, string>;
  /** Çalıştırılacak komut. */
  readonly command: readonly string[];
  /** Timeout (ms). */
  readonly timeoutMs?: number;
  /** Konteyner adı prefix'i — build/runtime kimlik ayrımı (Q2). */
  readonly namePrefix?: string;
  /** Port yayınlama — container içindeki HTTP'e host tarafından erişim için (bridge loopback). */
  readonly publishPorts?: ReadonlyArray<{ container: number; host: number }>;
}

export interface ContainerRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export interface ContainerInfo {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly image: string;
  readonly created: string;
}

export interface ContainerAvailability {
  readonly available: boolean;
  readonly reason: 'docker-not-found' | 'daemon-unavailable' | 'ok';
  readonly detail?: string;
}

/**
 * Q5 — Artifact export path containment.
 *
 * Container'dan host'a kopyalanan her yolun output dizini İÇİNDE kaldığını
 * doğrular. `/output/../../etc/passwd` gibi yollar ve dış absolute yollar
 * reddedilir.
 */
export function assertInsideDir(child: string, parent: string): string {
  const parentResolved = resolve(parent);
  const childResolved = resolve(child);
  const rel = relative(parentResolved, childResolved);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return childResolved;
  }
  throw new ContainerPathTraversalError(child, parent);
}

export class ContainerPathTraversalError extends Error {
  readonly code = 'CONTAINER_PATH_TRAVERSAL' as const;

  constructor(readonly artifactPath: string, readonly outputDir: string) {
    super(`Artifact yolu "${artifactPath}" output dizini ("${outputDir}") dışına taşmaya çalışıyor.`);
    this.name = 'ContainerPathTraversalError';
  }
}

/**
 * Q1/Q7/Q8 — Docker run argümanlarını üretir (SPIKE-EXECUTION-CONTAINER-001).
 *
 * ADR-0004 §4 zorunlu kontrollerinin tamamı burada toplanır; `run()` bu
 * fonksiyonun çıktısını birebir kullanır, böylece güvenlik profilini
 * sürüklenmekten koruyan testler gerçek davranışı doğrular.
 */
export function buildDockerRunArgs(
  options: {
    containerName: string;
    image: string;
    command: readonly string[];
    workDir?: string | undefined;
    mounts?: ContainerRunOptions['mounts'] | undefined;
    env?: Record<string, string> | undefined;
    publishPorts?: ContainerRunOptions['publishPorts'] | undefined;
    maxMemoryMb?: number | undefined;
    maxSwapMb?: number | undefined;
    cpus?: number | undefined;
    maxPids?: number | undefined;
    useInit?: boolean | undefined;
    tmpfsSizeMb?: number | undefined;
  },
): string[] {
  const args: string[] = [
    'run',
    '--rm',
    '--name', options.containerName,
    '--network', 'none', // Q3: network default deny
    '--read-only', // Q1: read-only root filesystem
    '--cap-drop', 'ALL', // Q1: capability yok
    '--security-opt', 'no-new-privileges', // Q1: suid/priv yok
  ];

  // `./gradlew` gibi göreli komutların çözüldüğü dizin; verilmezse container
  // kökünde (`/`) başlar ve göreli yol bulunamaz (canlı deneyde yakalandı).
  if (options.workDir) {
    args.push('--workdir', options.workDir);
  }

  // Q7/Q8: zombie reaper — konteyner ölünce içindeki process tree kesin ölür.
  if (options.useInit ?? true) {
    args.push('--init');
  }

  // Q1/Q10: kaynak kotaları.
  // `--memory-swap` = `--memory` (varsayılan): swap KAPALI. Docker varsayılanı
  // swap'i limitin 2 katına çıkarır; canlı deneyde (SPIKE-EXECUTION-CONTAINER-001
  // exp4) swap açıkken 300MB tahsis 256MB limiti altında tamamlanıyordu —
  // sınır yumuşak olur, süreç swap'a taşınır. Sert kill için swap kapatılır.
  const memoryMb = options.maxMemoryMb ?? 4096;
  args.push('--memory', `${memoryMb}m`);
  args.push('--memory-swap', `${options.maxSwapMb ?? memoryMb}m`);
  args.push('--cpus', String(options.cpus ?? 2));
  args.push('--pids-limit', String(options.maxPids ?? 512));

  // Q1: disposable writable fs — tmpfs üzerinde sınırlı yazma alanı (disk quota).
  args.push('--tmpfs', `/tmp:size=${options.tmpfsSizeMb ?? 100}m`);

  // Q6: host secret yok — mount'lar yalnızca explicit listeden gelir.
  for (const mount of options.mounts ?? []) {
    const readOnly = mount.readonly ? ':ro' : '';
    args.push('--volume', `${mount.source}:${mount.target}${readOnly}`);
  }

  // Q2: bridge loopback erişimi için explicit port yayınlama (default: hiçbiri).
  for (const port of options.publishPorts ?? []) {
    args.push('--publish', `${port.host}:${port.container}`);
  }

  // Q6: env allowlist — host env bu listeye KARIŞTIRILMAZ, yalnızca `env` alanı geçer.
  for (const [key, value] of Object.entries(options.env ?? {})) {
    args.push('--env', `${key}=${value}`);
  }

  args.push(options.image);
  args.push(...options.command);

  return args;
}

/**
 * Docker backend — container operasyonları.
 */
export class ContainerBackend {
  readonly #options: ContainerBackendOptions;
  readonly #dockerPath: string;

  constructor(options: ContainerBackendOptions = {}) {
    this.#options = options;
    this.#dockerPath = 'docker';
  }

  #log(level: string, event: string, fields: Record<string, unknown> = {}): void {
    this.#options.log?.(level, event, fields);
  }

  /**
   * Docker'ın mevcut olup olmadığını kontrol eder (boolean).
   */
  async isAvailable(): Promise<boolean> {
    return (await this.getAvailability()).available;
  }

  /**
   * Q9 — Container runtime yoksa nedenini teşhis eder.
   *
   * - `docker` komutu yok → `docker-not-found`
   * - Docker CLI var ama daemon'a ulaşılamıyor → `daemon-unavailable`
   *   (Windows'ta yaygın nedenler: Docker Desktop kapalı, WSL2 backend
   *   başlatılmamış — `docker info` stderr'i `detail` olarak döner)
   */
  async getAvailability(): Promise<ContainerAvailability> {
    const version = await this.#exec(['--version']);
    if (version.exitCode !== 0) {
      return {
        available: false,
        reason: 'docker-not-found',
        detail: 'docker CLI bulunamadı. Docker Desktop (WSL2 backend) kurun.',
      };
    }
    const info = await this.#exec(['info']);
    if (info.exitCode !== 0) {
      return {
        available: false,
        reason: 'daemon-unavailable',
        detail: `docker daemon'a ulaşılamadı (stderr: ${info.stderr.trim().slice(0, 400)}). Docker Desktop'un çalıştığından emin olun.`,
      };
    }
    return { available: true, reason: 'ok' };
  }

  /**
   * Yeni bir container oluşturur ve çalıştırır.
   */
  async run(options: ContainerRunOptions): Promise<ContainerRunResult> {
    const containerName = `${options.namePrefix ?? 'mcpdev-build'}-${Date.now()}-${randomBytes(8).toString('hex')}`;
    const startTime = Date.now();

    this.#log('INFO', 'container.run_started', {
      container_name: containerName,
      command: options.command,
    });

    const args = buildDockerRunArgs({
      containerName,
      image: this.#options.image ?? 'mcpdev-build:latest',
      command: options.command,
      workDir: options.workDir,
      mounts: options.mounts,
      env: options.env,
      publishPorts: options.publishPorts,
      maxMemoryMb: this.#options.maxMemoryMb,
      maxSwapMb: this.#options.maxSwapMb,
      cpus: this.#options.cpus,
      maxPids: this.#options.maxPids,
      useInit: this.#options.useInit,
    });
    const result = await this.#exec(args, options.timeoutMs ?? this.#options.timeoutMs ?? 300_000);
    const durationMs = Date.now() - startTime;

    // Q7/Q8: timeout'ta docker CLI'ı öldürmek container'ı durdurmaz — `--rm`
    // temizliği CLI tarafından yapılır, CLI ölünce container ayakta kalır
    // (orphan). Timeout sonrası container kesin silinir (canlı deney bulgusu).
    if (result.timedOut) {
      this.#log('WARN', 'container.run_timed_out', { container_name: containerName });
      await this.remove(containerName);
    }

    this.#log('INFO', 'container.run_completed', {
      container_name: containerName,
      exit_code: result.exitCode,
      duration_ms: durationMs,
      timed_out: result.timedOut,
    });

    return {
      ...result,
      durationMs,
    };
  }

  /**
   * Container durumunu sorgular.
   */
  async inspect(containerName: string): Promise<ContainerInfo | null> {
    try {
      const result = await this.#exec(['inspect', '--format', '{{.Id}}|{{.Name}}|{{.State.Status}}|{{.Config.Image}}|{{.Created}}', containerName]);
      if (result.exitCode !== 0) return null;

      const parts = result.stdout.trim().split('|');
      return {
        id: parts[0] ?? '',
        name: parts[1] ?? '',
        state: parts[2] ?? '',
        image: parts[3] ?? '',
        created: parts[4] ?? '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Container'ı durdurur.
   */
  async stop(containerName: string, timeoutSec = 10): Promise<boolean> {
    try {
      const result = await this.#exec(['stop', '-t', String(timeoutSec), containerName]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Container'ı siler.
   */
  async remove(containerName: string): Promise<boolean> {
    try {
      const result = await this.#exec(['rm', '-f', containerName]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Container listesini getirir.
   */
  async list(filter?: string): Promise<ContainerInfo[]> {
    const args = ['ps', '-a', '--format', '{{.ID}}|{{.Names}}|{{.State}}|{{.Image}}|{{.CreatedAt}}'];
    if (filter) args.push('--filter', filter);

    try {
      const result = await this.#exec(args);
      if (result.exitCode !== 0) return [];

      return result.stdout
        .trim()
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          const parts = line.split('|');
          return {
            id: parts[0] ?? '',
            name: parts[1] ?? '',
            state: parts[2] ?? '',
            image: parts[3] ?? '',
            created: parts[4] ?? '',
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Eski container'ları temizler (build + runtime prefix'leri).
   */
  async cleanup(_olderThanMinutes = 60): Promise<number> {
    const containers = await this.list('name=mcpdev-');
    let cleaned = 0;

    for (const container of containers) {
      if (container.state === 'exited' || container.state === 'dead') {
        await this.remove(container.name);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Q5 — Artifact'ı container çıktı dizininden host'a kopyalar (explicit copy).
   *
   * Kopyalama öncesi `assertInsideDir` ile path traversal reddedilir.
   */
  async collectArtifact(artifactPath: string, outputDir: string): Promise<{ sha256: string; byteSize: number; resolvedPath: string }> {
    const resolved = assertInsideDir(artifactPath, outputDir);
    const info = await stat(resolved);
    // Not: sha256 hesabı çağıran katmanda (Supervisor artifact store) yapılır;
    // burada yalnızca containment + boyut doğrulanır.
    return {
      sha256: '',
      byteSize: info.size,
      resolvedPath: resolved,
    };
  }

  /**
   * Docker komutunu çalıştırır.
   */
  async #exec(args: readonly string[], timeoutMs?: number): Promise<ContainerRunResult> {
    if (this.#options.execImpl) {
      return this.#options.execImpl(args, timeoutMs);
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      const proc = spawn(this.#dockerPath, [...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - startTime,
          timedOut,
        });
      });

      proc.on('error', () => {
        resolve({
          exitCode: 1,
          stdout,
          stderr: stderr + '\nDocker komutu başlatılamadı.',
          durationMs: Date.now() - startTime,
          timedOut: false,
        });
      });

      if (timeoutMs) {
        setTimeout(() => {
          timedOut = true;
          proc.kill('SIGTERM');
        }, timeoutMs);
      }
    });
  }
}

/**
 * Build ortamı — Docker container içinde Gradle build.
 *
 * Canlı deney sonuçlarına göre (SPIKE-EXECUTION-CONTAINER-001):
 *
 * 1. Kaynak `/src` READ-ONLY mount edilir (ADR-0004 §4) ama build doğrudan
 *    orada çalışmaz: Gradle 9 proje-içi `.gradle/` ve `build/reports/problems`
 *    dizinlerini yazar — ro kaynak bunları kaldırmaz. Kaynak, container
 *    başında `/output/src` içine (host-backed disposable dizine) KOPYALANIR
 *    ve build kopya üzerinde çalışır; host'taki doğrulanmış snapshot'a asla
 *    yazılmaz.
 *
 * 2. `GRADLE_USER_HOME` doğrudan ro cache mount edilemez: wrapper, dist
 *    dizinine `.lck`/`.ok` dosyalarını YAZAR (Install.createDist). Cache
 *    `/cache:ro`'dan `/output/.gradle`'a kopyalanarak tohumlanır (lock/tmp
 *    dosyaları hariç — bunlar process'e özgüdür, kopyaya taşınmaz).
 *
 * @param network `offline` ise `--offline` eklenir (Q3).
 * @param dependencyCacheDir verilirse host cache'i ro mount edilir ve
 *   `/output/.gradle`'a kopyalanır (offline reproducible build için).
 */
export class ContainerBuildEnvironment {
  readonly #backend: ContainerBackend;
  readonly #buildDir: string;
  readonly #outputDir: string;

  constructor(backend: ContainerBackend, buildDir: string, outputDir: string) {
    this.#backend = backend;
    this.#buildDir = buildDir;
    this.#outputDir = outputDir;
  }

  async build(
    _projectId: string,
    command: readonly string[] = ['./gradlew', 'build', '--no-daemon'],
    options: {
      timeoutMs?: number;
      env?: Record<string, string>;
      network?: 'offline' | 'repository-allowlist';
      dependencyCacheDir?: string;
    } = {},
  ): Promise<ContainerRunResult> {
    await mkdir(this.#outputDir, { recursive: true });

    const mounts: Array<{ source: string; target: string; readonly?: boolean }> = [
      { source: this.#buildDir, target: '/src', readonly: true },
      { source: this.#outputDir, target: '/output', readonly: false },
    ];

    const env: Record<string, string> = {
      HOME: '/tmp',
      GRADLE_USER_HOME: '/output/.gradle',
      ...options.env,
    };

    const steps: string[] = [];
    if (options.dependencyCacheDir) {
      mounts.push({ source: options.dependencyCacheDir, target: '/cache', readonly: true });
      steps.push(
        'mkdir -p /output/.gradle && ' +
          'tar -C /cache -cf - --exclude=*.lock --exclude=*.lck --exclude=*.tmp . | ' +
          'tar -C /output/.gradle -xf -',
      );
    }
    steps.push('cp -a /src/. /output/src/');

    const finalCommand = [...command];
    if (options.network === 'offline' && !finalCommand.includes('--offline')) {
      finalCommand.push('--offline');
    }
    steps.push(`exec ${finalCommand.map(shQuote).join(' ')}`);

    return this.#backend.run({
      workDir: '/output/src',
      mounts,
      env,
      command: ['sh', '-c', steps.join(' && ')],
      namePrefix: 'mcpdev-build',
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  /**
   * Container içinde test çalıştırır.
   */
  async test(
    projectId: string,
    command: readonly string[] = ['./gradlew', 'test', '--no-daemon'],
    options: { timeoutMs?: number; env?: Record<string, string>; network?: 'offline' | 'repository-allowlist' } = {},
  ): Promise<ContainerRunResult> {
    return this.build(projectId, command, options);
  }
}

/** POSIX sh için tek tırnaklı quote (komut zinciri argümanlarını güvenle taşır). */
function shQuote(arg: string): string {
  return `'${arg.replaceAll("'", "'\\''")}'`;
}
