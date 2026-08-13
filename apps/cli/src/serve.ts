/**
 * mcpdev serve — Supervisor + MCP Server launcher (P0-7).
 *
 * Tek komutla:
 *   1. Run Supervisor'ı çocuk process olarak başlatır (project kaydı ve
 *      registry kalıcılığı dahil — launcher yüzeyi).
 *   2. Named pipe endpoint'ini taşıyan kontrol dosyasını bekler.
 *   3. MCP Server'ı stdio inherit ile başlatır: parent'ın stdin/stdout'u
 *      doğrudan MCP protokolüdür.
 *   4. Lifecycle: MCP Server kapanınca Supervisor da SIGTERM alır; sinyalde
 *      önce MCP Server, sonra Supervisor temiz kapanır.
 *
 * Supervisor'ın stdout'u MCP protokolünü bozmasın diye stderr'e aktarılır
 * (supervisor standalone modda `[svc]` loglarını stdout'a yazar).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readControlFile, type SupervisorEndpoint } from '@mcpdev/contracts';
import { defaultEulaDataDir, eulaFilePath } from './eula.js';

export interface ServeOptions {
  readonly repoRoot: string;
  readonly profileId: string;
  readonly bridgeJarPath: string;
  readonly paperCacheDir: string;
  readonly runtimeRootDir?: string;
  readonly projectId?: string;
  readonly projectRoot?: string;
  readonly registryFile?: string;
  readonly evidenceDir?: string;
  readonly eulaFile?: string;
  /** Doğrulanmış bağımlılık cache (offline reproducible build'ler için). */
  readonly dependencyCacheDir?: string;
  readonly version?: string;
  readonly toolProfile?: string;
  readonly logLevel?: string;
  /** Supervisor giriş noktası (varsayılan: workspace düzeni). */
  readonly supervisorEntry?: string;
  /** MCP Server giriş noktası (varsayılan: workspace düzeni). */
  readonly mcpServerEntry?: string;
  /** Kontrol dosyası dizini; verilmezse her oturuma özel temp dizin. */
  readonly controlDir?: string;
  /** Kontrol dosyası için bekleme süresi (ms). Varsayılan: 15_000. */
  readonly startupTimeoutMs?: number;
  /** stderr'e yazılan log satırları (testlerde susturulur). */
  readonly log?: (line: string) => void;
}

export interface ServeResult {
  /** MCP Server'ın exit code'u (0 ise 0); launcher hatası ise 1. */
  readonly exitCode: number;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 100;

export function defaultSupervisorEntry(): string {
  const override = process.env['MCPDEV_SUPERVISOR_ENTRY'];
  if (override && override.trim() !== '') return override;
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
  return join(repoRoot, 'apps', 'run-supervisor', 'dist', 'src', 'main.js');
}

export function defaultMcpServerEntry(): string {
  const override = process.env['MCPDEV_MCP_SERVER_ENTRY'];
  if (override && override.trim() !== '') return override;
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
  return join(repoRoot, 'apps', 'mcp-server', 'dist', 'src', 'index.js');
}

/**
 * Çocuk process'lerin kontrol dosyasını dinlemeden önce MCPDEV_CONTROL_DIR'i
 * ortama yerleştirir. Mevcut bir supervisor'ın dosyasıyla çakışmamak için her
 * oturum kendi temp dizinini kullanır; aynı env çocuklara da kalıtılır.
 */
function ensureControlDir(options: ServeOptions): string {
  const dir = options.controlDir ?? mkdtempSync(join(tmpdir(), 'mcpdev-serve-'));
  mkdirSync(dir, { recursive: true });
  process.env['MCPDEV_CONTROL_DIR'] = dir;
  return dir;
}

/** MCP Server'ın çıkmasını ve ardından Supervisor'ın SIGTERM ile kapanmasını bekler. */
function forwardLog(child: ChildProcess): void {
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    process.stderr.write(chunk);
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    process.stderr.write(chunk);
  });
}

async function waitForControlFile(
  expectedPid: number,
  timeoutMs: number,
  log: (line: string) => void,
): Promise<SupervisorEndpoint> {
  const deadline = Date.now() + timeoutMs;
  let warnedStale = false;
  while (Date.now() < deadline) {
    const endpoint = await readControlFile();
    if (endpoint !== null) {
      if (endpoint.pid === expectedPid) {
        return endpoint;
      }
      if (!warnedStale) {
        log(`WARN başka bir supervisor'ın kontrol dosyası yoksayıldı (pid ${endpoint.pid})`);
        warnedStale = true;
      }
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
  throw new Error(`Supervisor kontrol dosyası ${timeoutMs}ms içinde oluşmadı`);
}

/**
 * Serve oturumunu çalıştırır; süreç her iki çocuk da kapanana kadar bekler.
 * Dönüş değeri launcher'ın exit code'udur.
 */
export async function runServe(options: ServeOptions): Promise<ServeResult> {
  const log = options.log ?? ((line: string) => process.stderr.write(`[serve] ${line}\n`));
  const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;

  const supervisorEntry = options.supervisorEntry ?? defaultSupervisorEntry();
  const mcpServerEntry = options.mcpServerEntry ?? defaultMcpServerEntry();
  ensureControlDir(options);

  if (options.projectId !== undefined && options.projectRoot === undefined) {
    throw new Error('--project-id yalnızca --project-root ile birlikte verilebilir');
  }
  if (options.projectId === undefined && options.projectRoot !== undefined) {
    throw new Error('--project-root yalnızca --project-id ile birlikte verilebilir');
  }

  const supervisorArgs = [
    'start',
    '--repo-root', resolve(options.repoRoot),
    '--profile-id', options.profileId,
    '--bridge-jar', resolve(options.bridgeJarPath),
    '--paper-cache', resolve(options.paperCacheDir),
    ...(options.runtimeRootDir !== undefined ? ['--runtime-root', resolve(options.runtimeRootDir)] : []),
    ...(options.projectId !== undefined ? ['--project-id', options.projectId] : []),
    ...(options.projectRoot !== undefined ? ['--project-root', resolve(options.projectRoot)] : []),
    ...(options.registryFile !== undefined ? ['--registry-file', resolve(options.registryFile)] : []),
    ...(options.evidenceDir !== undefined ? ['--evidence-dir', resolve(options.evidenceDir)] : []),
    ...(options.dependencyCacheDir !== undefined
      ? ['--dependency-cache-dir', resolve(options.dependencyCacheDir)]
      : []),
    '--eula-file', resolve(options.eulaFile ?? eulaFilePath(defaultEulaDataDir())),
    ...(options.version !== undefined ? ['--version', options.version] : []),
  ];

  log(`Supervisor başlatılıyor: node ${supervisorEntry} ${supervisorArgs.join(' ')}`);
  const supervisor = spawn(process.execPath, [supervisorEntry, ...supervisorArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  forwardLog(supervisor);

  let startupFailure: string | null = null;
  supervisor.on('exit', (code) => {
    // Kendi SIGTERM'imiz code null + signal taşır; gerçek çökme code !== 0.
    if (startupFailure === null && code !== null && code !== 0) {
      startupFailure = `Supervisor beklenmedik şekilde çıktı (exit ${code})`;
    }
  });

  let endpoint: SupervisorEndpoint;
  try {
    endpoint = await waitForControlFile(supervisor.pid ?? -1, startupTimeoutMs, log);
  } catch (err) {
    supervisor.kill('SIGTERM');
    throw new Error(
      startupFailure ?? (err instanceof Error ? err.message : String(err)),
    );
  }
  log(`Supervisor hazır (endpoint ${endpoint.path})`);

  const mcpServer = spawn(process.execPath, [mcpServerEntry], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: {
      ...process.env,
      MCPDEV_ROOT: resolve(options.repoRoot),
      ...(options.toolProfile !== undefined ? { MCPDEV_TOOL_PROFILE: options.toolProfile } : {}),
      ...(options.logLevel !== undefined ? { MCPDEV_LOG_LEVEL: options.logLevel } : {}),
    },
  });

  // MCP Server kapanınca Supervisor'ı da kapat (zincir).
  const mcpExited = new Promise<number>((resolveExit) => {
    mcpServer.on('exit', (code) => {
      resolveExit(code ?? 1);
    });
  });

  // Supervisor beklenmedik ölürse MCP Server'ı da kapat.
  supervisor.on('exit', () => {
    if (mcpServer.exitCode === null && mcpServer.signalCode === null) {
      mcpServer.kill('SIGTERM');
    }
  });

  const shutdown = (signal: string): void => {
    log(`Sinyal ${signal} — kapanış başlatılıyor`);
    if (mcpServer.exitCode === null && mcpServer.signalCode === null) {
      mcpServer.kill('SIGTERM');
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const mcpExitCode = await mcpExited;
  log(`MCP Server çıktı (exit ${mcpExitCode}) — Supervisor kapatılıyor`);
  if (supervisor.exitCode === null && supervisor.signalCode === null) {
    supervisor.kill('SIGTERM');
  }
  await new Promise<void>((resolveExit) => {
    if (supervisor.exitCode !== null || supervisor.signalCode !== null) {
      resolveExit();
      return;
    }
    const onExit = (): void => {
      supervisor.off('exit', onExit);
      resolveExit();
    };
    supervisor.on('exit', onExit);
    // Supervisor kapanışına ek süre tanı; asılı kalırsa zorla kapat.
    setTimeout(() => {
      supervisor.off('exit', onExit);
      if (supervisor.exitCode === null && supervisor.signalCode === null) {
        supervisor.kill('SIGKILL');
      }
      resolveExit();
    }, 10_000).unref();
  });

  process.removeListener('SIGINT', shutdown);
  process.removeListener('SIGTERM', shutdown);
  return { exitCode: mcpExitCode };
}
