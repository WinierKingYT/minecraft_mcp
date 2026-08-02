/**
 * Container Backend — Docker ile izole build/test ortamı.
 *
 * Plugin'leri izole Docker konteynerlerinde derler ve test eder.
 * Güvenlik: root erişimi yok, network kısıtlı, resource limitleri.
 */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export interface ContainerBackendOptions {
  /** Docker socket yolu. */
  readonly dockerSocket?: string;
  /** Kullanılacak image adı. */
  readonly image?: string;
  /** Container timeout (ms). */
  readonly timeoutMs?: number;
  /** Maksimum bellek (MB). */
  readonly maxMemoryMb?: number;
  /** Maksimum CPU (ns). */
  readonly maxCpuNs?: number;
  /** Logger. */
  readonly log?: (level: string, event: string, fields: Record<string, unknown>) => void;
}

export interface ContainerRunOptions {
  /** Çalışma dizini. */
  readonly workDir: string;
  /** Mount edilecek dizinler. */
  readonly mounts?: ReadonlyArray<{ source: string; target: string; readonly?: boolean }>;
  /** Environment değişkenleri. */
  readonly env?: Record<string, string>;
  /** Çalıştırılacak komut. */
  readonly command: readonly string[];
  /** Timeout (ms). */
  readonly timeoutMs?: number;
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
   * Docker'ın mevcut olup olmadığını kontrol eder.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.#exec(['--version']);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Yeni bir container oluşturur ve çalıştırır.
   */
  async run(options: ContainerRunOptions): Promise<ContainerRunResult> {
    const containerName = `mcpdev-build-${Date.now()}-${randomBytes(8).toString('hex')}`;
    const startTime = Date.now();

    this.#log('INFO', 'container.run_started', {
      container_name: containerName,
      command: options.command,
    });

    const args = [
      'run',
      '--rm',
      '--name', containerName,
      '--network', 'none', // Network kısıtlaması
      '--memory', `${this.#options.maxMemoryMb ?? 512}m`,
      '--cpus', '1',
      '--read-only', // Salt okunur root filesystem
      '--tmpfs', '/tmp:size=100m',
      '--security-opt', 'no-new-privileges',
    ];

    // Mount'ları ekle
    for (const mount of options.mounts ?? []) {
      const readOnly = mount.readonly ? ':ro' : '';
      args.push('--volume', `${mount.source}:${mount.target}${readOnly}`);
    }

    // Environment değişkenleri
    for (const [key, value] of Object.entries(options.env ?? {})) {
      args.push('--env', `${key}=${value}`);
    }

    // Image ve komut
    args.push(this.#options.image ?? 'mcpdev-build:latest');
    args.push(...options.command);

    const result = await this.#exec(args, options.timeoutMs ?? this.#options.timeoutMs ?? 300_000);
    const durationMs = Date.now() - startTime;

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
   * Eski container'ları temizler.
   */
  async cleanup(_olderThanMinutes = 60): Promise<number> {
    const containers = await this.list('name=mcpdev-build-');
    let cleaned = 0;

    for (const container of containers) {
      // Eski container'ları sil
      if (container.state === 'exited' || container.state === 'dead') {
        await this.remove(container.name);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Docker komutunu çalıştırır.
   */
  async #exec(args: readonly string[], timeoutMs?: number): Promise<ContainerRunResult> {
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

      // Timeout kontrolü
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

  /**
   * Container içinde build çalıştırır.
   */
  async build(
    _projectId: string,
    command: readonly string[] = ['./gradlew', 'build', '--no-daemon'],
    options: { timeoutMs?: number; env?: Record<string, string> } = {},
  ): Promise<ContainerRunResult> {
    await mkdir(this.#outputDir, { recursive: true });

    return this.#backend.run({
      workDir: '/workspace',
      mounts: [
        { source: this.#buildDir, target: '/workspace', readonly: true },
        { source: this.#outputDir, target: '/output', readonly: false },
      ],
      env: {
        HOME: '/tmp',
        GRADLE_USER_HOME: '/tmp/.gradle',
        ...options.env,
      },
      command,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  /**
   * Container içinde test çalıştırır.
   */
  async test(
    projectId: string,
    command: readonly string[] = ['./gradlew', 'test', '--no-daemon'],
    options: { timeoutMs?: number; env?: Record<string, string> } = {},
  ): Promise<ContainerRunResult> {
    return this.build(projectId, command, options);
  }
}
