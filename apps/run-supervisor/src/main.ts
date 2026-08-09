/**
 * Run-supervisor standalone giriş noktası (MCP araç yüzeyi için).
 *
 * SupervisorService + SupervisorIpcServer'ı tek process'te ayağa kaldırır,
 * named pipe endpoint'ini kontrol dosyasına yazar ve sinyal ile temiz kapanır.
 * MCP Server bu kontrol dosyasını okuyarak bağlanır (contracts/endpoint.ts).
 *
 * Kullanım:
 *   mcpdev-supervisor start \
 *     --repo-root <path> --profile-id <id> --bridge-jar <path> \
 *     --paper-cache <path> --runtime-root <path> \
 *     [--project-id <id> --project-root <path> --version <v>]
 */

import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { EvidenceStore } from '@mcpdev/evidence-model';
import { SupervisorService } from './service.js';
import { SupervisorIpcServer } from './ipc-server.js';
import { makeEndpointPath, newToken, writeControlFile, removeControlFile } from './endpoint.js';
import { ProjectRegistry } from './project-registry.js';

interface StartOptions {
  readonly repoRoot: string;
  readonly profileId: string;
  readonly bridgeJarPath: string;
  readonly paperCacheDir: string;
  readonly runtimeRootDir?: string;
  readonly projectId?: string;
  readonly projectRoot?: string;
  readonly version?: string;
  readonly evidenceDir?: string;
}

function log(level: string, event: string, fields?: Record<string, unknown>): void {
  const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
  process.stdout.write(`[svc] ${level} ${event}${suffix}\n`);
}

async function start(options: StartOptions): Promise<never> {
  const runtimeRoot =
    options.runtimeRootDir ??
    (await mkdtemp(join(tmpdir(), 'mcpdev-supervisor-')));

  const projectRegistry = new ProjectRegistry();
  if (options.projectId && options.projectRoot) {
    await projectRegistry.register(options.projectId, {
      canonicalRoot: resolve(options.projectRoot),
      trustLevel: 'approved-fixture',
      allowedBackends: ['trusted-local', 'container'],
      defaultBackend: 'trusted-local',
    });
    log('INFO', 'project.registered', { project_id: options.projectId });
  }

  const service = new SupervisorService({
    repoRoot: resolve(options.repoRoot),
    profileId: options.profileId,
    bridgeJarPath: options.bridgeJarPath,
    paperCacheDir: options.paperCacheDir,
    runtimeRootDir: runtimeRoot,
    version: options.version ?? '0.1.0',
    projectRegistry,
    log,
    ...(options.evidenceDir !== undefined
      ? { evidenceStore: new EvidenceStore(resolve(options.evidenceDir)) }
      : {}),
  });

  const endpoint = {
    path: makeEndpointPath(),
    token: newToken(),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  const server = new SupervisorIpcServer({
    endpointPath: endpoint.path,
    token: endpoint.token,
    handlers: service.handlers(),
    log: (level, event, fields) => log('[ipc]', `${level} ${event}`, fields),
  });

  await server.listen();
  const controlFile = await writeControlFile(endpoint);
  log('INFO', 'ipc.listening', { endpoint: endpoint.path, control_file: controlFile });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('INFO', 'shutdown.started', { signal });
    void server
      .close()
      .catch((err: unknown) => log('ERROR', 'shutdown.ipc_failed', { error: String(err) }))
      .finally(() => {
        removeControlFile().catch(() => {});
        log('INFO', 'shutdown.complete', {});
        process.exit(0);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Sonsuz bekleyiş: IPC server bakımı async event'lerle sürer.
  return new Promise<never>(() => {});
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      'repo-root': { type: 'string' },
      'profile-id': { type: 'string' },
      'bridge-jar': { type: 'string' },
      'paper-cache': { type: 'string' },
      'runtime-root': { type: 'string' },
      'project-id': { type: 'string' },
      'project-root': { type: 'string' },
      'evidence-dir': { type: 'string' },
      version: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  const command = process.argv[2];

  if (command === 'start' && !values.help) {
    const required = ['repo-root', 'profile-id', 'bridge-jar', 'paper-cache'] as const;
    const missing = required.filter((key) => values[key] === undefined);
    if (missing.length > 0) {
      process.stderr.write(`Eksik zorunlu seçenekler: ${missing.join(', ')}\n`);
      process.exit(2);
    }
    void start({
      repoRoot: values['repo-root'] as string,
      profileId: values['profile-id'] as string,
      bridgeJarPath: values['bridge-jar'] as string,
      paperCacheDir: values['paper-cache'] as string,
      ...(values['runtime-root'] !== undefined ? { runtimeRootDir: values['runtime-root'] as string } : {}),
      ...(values['project-id'] !== undefined ? { projectId: values['project-id'] as string } : {}),
      ...(values['project-root'] !== undefined ? { projectRoot: values['project-root'] as string } : {}),
      ...(values['evidence-dir'] !== undefined ? { evidenceDir: values['evidence-dir'] as string } : {}),
      ...(values.version !== undefined ? { version: values.version as string } : {}),
    }).catch((err) => {
      process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
    return;
  }

  process.stderr.write(`Usage: mcpdev-supervisor start [options]\n`);
  process.exit(2);
}

main();
