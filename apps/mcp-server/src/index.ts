#!/usr/bin/env node
/**
 * MCP Server giriş noktası.
 *
 * SIRA ÖNEMLİDİR: stdout guard, BAŞKA HİÇBİR ŞEY yüklenmeden önce kurulur.
 * Aksi hâlde import zamanında çalışan bir kütüphane logu stdout'a düşer ve
 * protokolü daha ilk mesajdan önce bozar.
 */

import { installStdoutGuard } from './transport/stdout-guard.js';
import { join } from 'node:path';

const guard = installStdoutGuard();

const { StdioTransport } = await import('./transport/stdio-transport.js');
const { ToolFacade } = await import('./tools/facade.js');
const { createSystemTools, defaultProfilePath } = await import('./tools/system.js');
const { createProjectTools } = await import('./tools/project.js');
const { createBuildTools } = await import('./tools/build.js');
const { createRuntimeTools } = await import('./tools/runtime.js');
const { createDiagnoseTools } = await import('./tools/diagnose.js');
const { createOperationTools } = await import('./tools/operation.js');
const { createScenarioTools } = await import('./tools/scenario.js');
const { createEvidenceTools } = await import('./tools/evidence.js');
const { McpServer } = await import('./server.js');
const { log, setLogLevel } = await import('./logging.js');
const { DEFAULT_TOOL_PROFILE, TOOL_PROFILES } = await import('@mcpdev/generated-types');

const SERVER_NAME = 'minecraft-plugin-dev-mcp';
const SERVER_VERSION = '0.1.0-prototype.0';
const COMPATIBILITY_PROFILE_ID = 'paper-26.2-build-84-v1';

// Protokol sürümü uyumluluk profilinden gelir; kod içine gömülü sürüm sabiti
// bulunmaz (compatibility/README.md kural 1).
const PROTOCOL_VERSION = process.env['MCP_PROTOCOL_VERSION'] ?? '2026-07-28';

const repoRoot = process.env['MCPDEV_ROOT'] ?? process.cwd();

const requestedProfile = process.env['MCPDEV_TOOL_PROFILE'] ?? DEFAULT_TOOL_PROFILE;
const profile = (
  Object.prototype.hasOwnProperty.call(TOOL_PROFILES, requestedProfile) ? requestedProfile : DEFAULT_TOOL_PROFILE
) as keyof typeof TOOL_PROFILES;

if (requestedProfile !== profile) {
  log('WARN', 'config.tool_profile.unknown', { requested: requestedProfile, fallback: profile });
}

setLogLevel((process.env['MCPDEV_LOG_LEVEL'] as 'ERROR' | 'WARN' | 'INFO' | 'DEBUG') ?? 'INFO');

const { readControlFile } = await import('@mcpdev/contracts');
const { SupervisorClient } = await import('./supervisor-client.js');

/**
 * Supervisor'a bağlanır.
 *
 * ADR-0003: MCP Server Supervisor'ı DOĞURMAZ. Çalışmıyorsa `null` döner ve
 * bu durum system_health yanıtında açıkça bildirilir.
 */
let supervisorClient: InstanceType<typeof SupervisorClient> | null = null;
const connectSupervisor = async (): Promise<InstanceType<typeof SupervisorClient> | null> => {
  if (supervisorClient) return supervisorClient;
  const endpoint = await readControlFile();
  if (!endpoint) return null;
  supervisorClient = new SupervisorClient({ endpointPath: endpoint.path, token: endpoint.token });
  return supervisorClient;
};

const facade = new ToolFacade(profile);
for (const [definition, handler] of createSystemTools({
  serverVersion: SERVER_VERSION,
  compatibilityProfileId: COMPATIBILITY_PROFILE_ID,
  compatibilityProfilePath: defaultProfilePath(repoRoot, COMPATIBILITY_PROFILE_ID),
  supervisor: connectSupervisor,
})) {
  facade.register(definition, handler);
}

for (const [definition, handler] of createProjectTools({ supervisor: connectSupervisor })) {
  facade.register(definition, handler);
}

for (const [definition, handler] of createBuildTools({ supervisor: connectSupervisor })) {
  facade.register(definition, handler);
}

for (const [definition, handler] of createRuntimeTools({ supervisor: connectSupervisor })) {
  facade.register(definition, handler);
}

for (const [definition, handler] of createDiagnoseTools({ supervisor: connectSupervisor })) {
  facade.register(definition, handler);
}

for (const [definition, handler] of createOperationTools({ supervisor: connectSupervisor })) {
  facade.register(definition, handler);
}

for (const [definition, handler] of createScenarioTools({
  supervisor: connectSupervisor,
  scenariosDir: join(repoRoot, 'scenarios'),
})) {
  facade.register(definition, handler);
}

for (const [definition, handler] of createEvidenceTools({ supervisor: connectSupervisor })) {
  facade.register(definition, handler);
}

const transport = new StdioTransport(guard);
const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
  protocolVersion: PROTOCOL_VERSION,
  facade,
  transport,
});

const shutdown = (signal: string): void => {
  log('INFO', 'server.shutdown', { signal, stdout_violations: guard.violationCount() });
  supervisorClient?.close();
  void transport.close().then(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.start();
