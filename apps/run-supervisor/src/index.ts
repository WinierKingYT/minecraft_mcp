#!/usr/bin/env node
/**
 * Run Supervisor giriş noktası — ADR-0003.
 *
 * Supervisor **bağımsız** bir process'tir. MCP Server ona bağlanır; onu
 * doğurmaz. MCP Server çöktüğünde Paper process sahipliği burada kalır.
 *
 * Supervisor'ın stdout'u üzerinde MCP invariant'ı yoktur (protokol taşımaz);
 * yine de tutarlılık için tüm log stderr'e yazılır.
 */

import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { verifyOwnership, type OwnershipRecord, type ProcessFingerprint } from './ownership.js';
import { assertBackendPairing } from './backend.js';
import { SupervisorIpcServer } from './ipc-server.js';
import { SupervisorService } from './service.js';
import { makeEndpointPath, newToken, writeControlFile, removeControlFile } from './endpoint.js';

const VERSION = '0.1.0-prototype.0';

export function log(level: string, event: string, fields: Record<string, unknown>): void {
  process.stderr.write(JSON.stringify({ level, component: 'run-supervisor', event, ...fields }) + '\n');
}

/**
 * Startup recovery — ADR-0003 madde 2.
 *
 * Supervisor yeniden başladığında kayıtlı process'lerin hâlâ bize ait olup
 * olmadığını doğrular. Uyuşmayan kayıtlar ORPHANED olarak işaretlenir;
 * KÖRLEMESİNE ÖLDÜRME YAPILMAZ.
 */
export function runStartupRecovery(
  records: readonly OwnershipRecord[],
  observe: (pid: number) => ProcessFingerprint | null,
): { readonly reclaimed: OwnershipRecord[]; readonly orphaned: OwnershipRecord[] } {
  const reclaimed: OwnershipRecord[] = [];
  const orphaned: OwnershipRecord[] = [];

  for (const record of records) {
    const observed = observe(record.pid);
    const verdict = verifyOwnership(record, observed);

    if (verdict.owned) {
      reclaimed.push(record);
      continue;
    }

    orphaned.push(record);
    log('WARN', 'recovery.ownership.mismatch', {
      runtime_id: record.runtimeId,
      server_instance_id: record.serverInstanceId,
      kind: record.kind,
      reason: verdict.reason,
      action: 'not_terminated',
    });
  }

  log('INFO', 'recovery.completed', { reclaimed: reclaimed.length, orphaned: orphaned.length });
  return { reclaimed, orphaned };
}

async function main(): Promise<void> {
  const repoRoot = process.env['MCPDEV_ROOT'] ?? process.cwd();
  const dataRoot = process.env['MCPDEV_DATA_ROOT'] ?? join(repoRoot, '.mcpdev-data');

  const service = new SupervisorService({
    repoRoot,
    profileId: process.env['MCPDEV_PROFILE'] ?? 'paper-26.2-build-84-v1',
    bridgeJarPath:
      process.env['MCPDEV_BRIDGE_JAR'] ??
      join(repoRoot, 'bridge', 'paper', 'build', 'libs', `paper-bridge-${VERSION}.jar`),
    paperCacheDir: join(dataRoot, 'paper-cache'),
    runtimeRootDir: join(dataRoot, 'runtimes'),
    version: VERSION,
    log,
  });

  // M0: kalıcı registry henüz yok, bu yüzden kurtarılacak kayıt da yok.
  // Bu durum health yanıtında gizlenmiyor.
  runStartupRecovery([], () => null);

  const endpointPath = makeEndpointPath();
  const token = newToken();

  const ipc = new SupervisorIpcServer({ endpointPath, token, handlers: service.handlers(), log });
  await ipc.listen();

  const controlFile = await writeControlFile({
    path: endpointPath,
    token,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });

  log('INFO', 'supervisor.started', {
    version: VERSION,
    node: process.versions.node,
    endpoint: endpointPath,
    control_file: controlFile,
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('INFO', 'supervisor.shutdown', { signal });

    void (async () => {
      // Sahip olduğumuz Paper process'lerini arkamızda bırakmayız.
      await service.shutdown();
      await ipc.close();
      await removeControlFile();
      process.exit(0);
    })();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

export { assertBackendPairing };

// Yalnızca doğrudan çalıştırıldığında main(); import edildiğinde değil.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  void main();
}
