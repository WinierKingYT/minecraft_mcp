#!/usr/bin/env node
/**
 * MCP Server giriş noktası.
 *
 * SIRA ÖNEMLİDİR: stdout guard, BAŞKA HİÇBİR ŞEY yüklenmeden önce kurulur.
 * Aksi hâlde import zamanında çalışan bir kütüphane logu stdout'a düşer ve
 * protokolü daha ilk mesajdan önce bozar.
 *
 * Protokol yüzeyi official SDK üzerindedir (ADR-0008):
 * serveStdio, bağlantı açılışını era negotiation ile yönetir — 2026-07-28
 * claim'leri modern (stateless) bağlantı açar, initialize ile gelen 2025-11-25
 * client'lar legacy shim ile servis edilir (SPIKE-MCP-SDK-2026-001).
 */

import { installStdoutGuard } from './transport/stdout-guard.js';
import { join } from 'node:path';

installStdoutGuard();

const { serveStdio } = await import('@modelcontextprotocol/server/stdio');
const { buildSdkServer } = await import('./sdk/adapter.js');
const { ResourceFacade } = await import('./resources/facade.js');
const { ToolFacade } = await import('./tools/facade.js');
const { createSystemTools, defaultProfilePath } = await import('./tools/system.js');
const { createProjectTools } = await import('./tools/project.js');
const { createBuildTools } = await import('./tools/build.js');
const { createRuntimeTools } = await import('./tools/runtime.js');
const { createDiagnoseTools } = await import('./tools/diagnose.js');
const { createOperationTools } = await import('./tools/operation.js');
const { createPoolTools } = await import('./tools/pool.js');
const { createProfileTools } = await import('./tools/profile.js');
const { createPermissionTools } = await import('./tools/permission.js');
const { createScenarioTools } = await import('./tools/scenario.js');
const { createEvidenceTools } = await import('./tools/evidence.js');
const { log, setLogLevel } = await import('./logging.js');
const { DEFAULT_TOOL_PROFILE, TOOL_PROFILES } = await import('@mcpdev/generated-types');

const SERVER_NAME = 'minecraft-plugin-dev-mcp';
const SERVER_VERSION = '0.1.0-prototype.0';
const COMPATIBILITY_PROFILE_ID = 'paper-26.2-build-84-v1';
const TOOL_LIST_TTL_MS = 300_000;

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
let supervisorConnect: Promise<InstanceType<typeof SupervisorClient> | null> | null = null;
const connectSupervisor = (): Promise<InstanceType<typeof SupervisorClient> | null> => {
  if (supervisorClient) return Promise.resolve(supervisorClient);
  // Eşzamanlı ilk çağrılar tek bağlantıya çözülür: await noktasında ikinci
  // çağrı da girerse aksi halde iki client kurulur, biri kapatılamadan kalır.
  supervisorConnect ??= (async () => {
    const endpoint = await readControlFile();
    if (!endpoint) return null;
    supervisorClient = new SupervisorClient({ endpointPath: endpoint.path, token: endpoint.token });
    return supervisorClient;
  })();
  return supervisorConnect;
};

const facade = new ToolFacade(profile);
const resources = new ResourceFacade({ supervisor: connectSupervisor });
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

for (const [definition, handler] of createPoolTools({ supervisor: connectSupervisor })) {
  facade.register(definition, handler);
}

for (const [definition, handler] of createProfileTools({ supervisor: connectSupervisor })) {
  facade.register(definition, handler);
}

for (const [definition, handler] of createPermissionTools({ supervisor: connectSupervisor })) {
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

// Bağlantı başına bir SDK server örneği (stateless, ADR-0008). Factory,
// serveStdio tarafından her bağlantı için bir kez çağrılır.
const handle = serveStdio(() =>
  buildSdkServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    facade,
    resources,
    toolListTtlMs: TOOL_LIST_TTL_MS,
  }),
);

const shutdown = (signal: string): void => {
  log('INFO', 'server.shutdown', { signal });
  supervisorClient?.close();
  void handle.close().then(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// stdin EOF = istemci bağlantıyı kapattı (serve launcher veya test). SDK'nın
// transport'ı EOF'ta kendiliğinden kapanmaz; üstelik mesajlar asenkron kuyrukla
// işlendiğinden EOF, devam eden tools/call'ların süpervizöre bağlanmasından
// ÖNCE gelebilir. Bu yüzden önce connectSupervisor'ın kurulum promise'i
// beklenir (aynı in-flight isteğin kuracağı bağlantı), sonra devam eden IPC
// çağrıları boşaltılır, sonra socket kapatılır. Böylece yanıtlar kesilmez ve
// named pipe handle'ı event loop'u tutmaz — süreç doğal olarak 0 ile çıkar.
const STDIN_END_GRACE_MS = 5_000;

process.stdin.on('end', () => {
  void (async () => {
    log('INFO', 'server.stdin_end', {});
    // SDK mesajları asenkron kuyrukla işler; EOF geldiğinde kuyrukta bekleyen
    // istekler olabilir. Kuyruk kanala teslim edilene kadar kısa bir süre
    // beklenir; ardından devam eden IPC çağrıları boşaltılıp socket kapatılır.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const deadline = Date.now() + STDIN_END_GRACE_MS;
    const client = await connectSupervisor();
    while (client && client.pendingCount > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    client?.close();
  })();
});
