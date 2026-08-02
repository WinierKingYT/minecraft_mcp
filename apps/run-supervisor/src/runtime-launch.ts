/**
 * Paper process yaşam döngüsü.
 *
 * security/controls.md:
 *   PR-01 Shell KULLANILMAZ
 *   PR-02 Process argüman dizisiyle başlatılır
 *   PR-03 Linux'ta process group; Windows'ta process tree kill
 *   PR-04 PID yanında executable, başlangıç zamanı ve marker fingerprint saklanır
 *   PR-06 Timeout tüm child process tree'ye uygulanır
 *   PR-09 Port serbestlik kontrolü cleanup kanıtına eklenir
 *   PR-10 Force termination ayrı durum ve audit event üretir
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { BridgeClient, readHandshake, type Handshake } from './bridge-client.js';
import type { RuntimeImage } from './runtime-image.js';

export class RuntimeLaunchError extends Error {
  constructor(
    readonly code:
      | 'STARTUP_TIMEOUT'
      | 'READY_GATE_FAILED'
      | 'RUNTIME_CRASHED'
      | 'SHUTDOWN_TIMEOUT'
      | 'PORT_STILL_BOUND',
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeLaunchError';
  }
}

export interface RunningRuntime {
  readonly process: ChildProcess;
  readonly pid: number;
  readonly javaExecutable: string;
  readonly startedAtMs: number;
  readonly runtimeMarkerSha256: string;
  readonly handshake: Handshake;
  readonly handshakeFile: string;
  readonly client: BridgeClient;
  readonly logLines: readonly string[];
}

export interface CleanupResult {
  readonly graceful: boolean;
  readonly forceTerminated: boolean;
  readonly exitCode: number | null;
  readonly portReleased: boolean;
  readonly handshakeRemoved: boolean;
  readonly durationMs: number;
}

export interface LaunchOptions {
  readonly image: RuntimeImage;
  readonly javaExecutable: string;
  readonly startupTimeoutMs?: number;
  readonly maxHeapMb?: number;
  /** Test/teşhis için canlı log akışı. */
  readonly onLogLine?: (line: string) => void;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 180_000;

/** Paper'ı başlatır ve ready gate'i geçene kadar bekler. */
export async function launchPaper(options: LaunchOptions): Promise<RunningRuntime> {
  const { image, javaExecutable } = options;
  const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;

  const args = [
    `-Xmx${options.maxHeapMb ?? 2048}M`,
    // Bridge'in yönetilen runtime'ı tanıması için gereken iki özellik.
    `-Dmcpdev.runtime.root=${image.runtimeRoot}`,
    `-Dmcpdev.server.instance.id=${image.serverInstanceId}`,
    // Determinizm: süreç yerel ayarları sabitlenir.
    '-Duser.language=en',
    '-Duser.country=US',
    '-Dfile.encoding=UTF-8',
    '-Duser.timezone=UTC',
    '-jar',
    image.paperJarPath,
    '--nogui',
  ];

  // PR-01/PR-02: shell yok, argüman dizisi var.
  const child = spawn(javaExecutable, args, {
    cwd: image.runtimeRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    // POSIX'te kendi process grubunu alır; tüm ağaç birlikte sonlandırılabilir.
    detached: process.platform !== 'win32',
    env: {
      // Environment allowlist: host ortamı olduğu gibi aktarılmaz.
      PATH: process.env['PATH'] ?? '',
      JAVA_HOME: process.env['JAVA_HOME'] ?? '',
      SystemRoot: process.env['SystemRoot'] ?? '',
      TEMP: image.runtimeRoot,
      TMP: image.runtimeRoot,
    },
  });

  if (child.pid === undefined) {
    throw new RuntimeLaunchError('RUNTIME_CRASHED', 'Paper process başlatılamadı.');
  }

  const startedAtMs = Date.now();
  const logLines: string[] = [];
  let exited = false;
  let exitCode: number | null = null;

  const capture = (chunk: Buffer): void => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line.trim() === '') continue;
      // Sınırlı tampon: sonsuz log büyümesi engellenir.
      if (logLines.length < 5000) logLines.push(line);
      options.onLogLine?.(line);
    }
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });

  const markerSha = createHash('sha256').update(await readFile(image.markerFile)).digest('hex');

  // ---- Ready gate ----------------------------------------------------------
  // "Process ayakta" YETMEZ. Üç şart birlikte aranır:
  //   1. Bridge handshake dosyası yazıldı
  //   2. /v1/health yanıt veriyor ve boot_id eşleşiyor
  //   3. PaperBridge plugin'i enabled
  const deadline = startedAtMs + startupTimeoutMs;

  let handshake: Handshake | undefined;
  while (Date.now() < deadline) {
    if (exited) {
      throw new RuntimeLaunchError(
        'RUNTIME_CRASHED',
        `Paper startup sırasında sonlandı (exit ${exitCode}).\n${lastLines(logLines, 25)}`,
      );
    }
    if (existsSync(image.handshakeFile)) {
      try {
        handshake = await readHandshake(image.handshakeFile);
        break;
      } catch {
        // Yarım yazılmış olabilir; atomik rename sayesinde nadir. Tekrar dene.
      }
    }
    await delay(250);
  }

  if (!handshake) {
    await forceKill(child);
    throw new RuntimeLaunchError(
      'STARTUP_TIMEOUT',
      `Bridge handshake ${startupTimeoutMs} ms içinde oluşmadı.\n${lastLines(logLines, 25)}`,
    );
  }

  if (handshake.server_instance_id !== image.serverInstanceId) {
    await forceKill(child);
    throw new RuntimeLaunchError(
      'READY_GATE_FAILED',
      `Handshake başka bir runtime'a ait: ${handshake.server_instance_id}`,
    );
  }

  const client = new BridgeClient(handshake.port, image.token);

  let ready = false;
  while (Date.now() < deadline) {
    if (exited) {
      throw new RuntimeLaunchError(
        'RUNTIME_CRASHED',
        `Paper ready gate sırasında sonlandı (exit ${exitCode}).\n${lastLines(logLines, 25)}`,
      );
    }
    try {
      const health = await client.health();
      if (health['ok'] === true && health['bridge_boot_id'] === handshake.bridge_boot_id) {
        const plugins = await client.query('plugin.list');
        const list = (plugins['plugins'] ?? []) as Array<{ name?: string; enabled?: boolean }>;
        if (list.some((p) => p.name === 'PaperBridge' && p.enabled === true)) {
          ready = true;
          break;
        }
      }
    } catch {
      // Bridge henüz hazır değil.
    }
    await delay(250);
  }

  if (!ready) {
    await forceKill(child);
    throw new RuntimeLaunchError(
      'READY_GATE_FAILED',
      `Ready gate ${startupTimeoutMs} ms içinde geçilemedi.\n${lastLines(logLines, 25)}`,
    );
  }

  return {
    process: child,
    pid: child.pid,
    javaExecutable,
    startedAtMs,
    runtimeMarkerSha256: markerSha,
    handshake,
    handshakeFile: image.handshakeFile,
    client,
    logLines,
  };
}

/**
 * Graceful stop; süre aşımında force termination.
 *
 * Force termination AYRI bir durumdur ve kanıta yazılır (PR-10): "durdu" ile
 * "öldürüldü" aynı sonuç değildir.
 */
export async function stopPaper(runtime: RunningRuntime, shutdownTimeoutMs = 30_000): Promise<CleanupResult> {
  const started = Date.now();
  const child = runtime.process;

  if (child.exitCode !== null || child.signalCode !== null) {
    return finish(runtime, started, true, false, child.exitCode);
  }

  // Paper konsoluna "stop" yazmak, kaydetme ve plugin onDisable akışını
  // tamamlayan tek temiz yoldur.
  try {
    child.stdin?.write('stop\n');
    child.stdin?.end();
  } catch {
    // stdin kapalıysa doğrudan force'a düşeriz.
  }

  const exited = await waitForExit(child, shutdownTimeoutMs);
  if (exited) {
    return finish(runtime, started, true, false, child.exitCode);
  }

  await forceKill(child);
  await waitForExit(child, 5000);
  return finish(runtime, started, false, true, child.exitCode);
}

async function finish(
  runtime: RunningRuntime,
  startedMs: number,
  graceful: boolean,
  forced: boolean,
  exitCode: number | null,
): Promise<CleanupResult> {
  // PR-09: port serbestliği cleanup kanıtının parçasıdır. Kalan bir handshake
  // dosyası da Supervisor'ı ölü bir porta yönlendireceği için kanıta girer.
  return {
    graceful,
    forceTerminated: forced,
    exitCode,
    portReleased: !(await isPortBound(runtime.handshake.port)),
    handshakeRemoved: !existsSync(runtime.handshakeFile),
    durationMs: Date.now() - startedMs,
  };
}

/** Windows'ta process tree, POSIX'te process group sonlandırılır (PR-03, PR-06). */
export async function forceKill(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;

  if (process.platform === 'win32') {
    await new Promise<void>((res) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('exit', () => res());
      killer.on('error', () => res());
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Zaten sonlanmış.
    }
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);

  return new Promise((res) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      res(false);
    }, timeoutMs);

    function onExit(): void {
      clearTimeout(timer);
      res(true);
    }
    child.once('exit', onExit);
  });
}

export function isPortBound(port: number): Promise<boolean> {
  return new Promise((res) => {
    const socket = createConnection({ host: '127.0.0.1', port, timeout: 1000 });
    socket.on('connect', () => {
      socket.destroy();
      res(true);
    });
    socket.on('error', () => {
      socket.destroy();
      res(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      res(false);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function lastLines(lines: readonly string[], count: number): string {
  return lines.slice(-count).join('\n');
}
