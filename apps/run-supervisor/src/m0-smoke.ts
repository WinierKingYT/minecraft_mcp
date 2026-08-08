/**
 * M0 dikey dilim smoke akışı.
 *
 * Demo tanımı (docs/delivery/roadmap.md M0):
 *   "AI istemcisi çalışan disposable Paper runtime'ın sürümünü, plugin'lerini,
 *    dünyalarını ve event'lerini okur; hiçbir mutation aracı developer
 *    profile'da görünmez."
 *
 * Bu akış GERÇEK Paper başlatır ve bu yüzden normal CI'da koşmaz:
 *   - Minecraft EULA kabulü gerektirir (kullanıcı kararı),
 *   - ~60 MB Paper JAR ve dünya üretimi gerektirir.
 *
 * Nightly gerçek-Paper işine bağlanacaktır.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadCompatibilityProfile, assertProfileUsable } from './compatibility.js';
import { resolveJavaForProfile } from './java-toolchain.js';
import { resolveBuild, downloadPaperJar } from './paper-download.js';
import { createRuntimeImage } from './runtime-image.js';
import { launchPaper, stopPaper, isPortBound } from './runtime-launch.js';

export interface SmokeOptions {
  readonly repoRoot: string;
  readonly profileId: string;
  readonly bridgeJarPath: string;
  readonly paperCacheDir: string;
  /** Kullanıcının açık EULA kabulü. Varsayılan false. */
  readonly acceptMinecraftEula: boolean;
  readonly keepRuntime?: boolean;
  readonly startupTimeoutMs?: number;
  readonly log?: (message: string) => void;
  /** Runtime'a yüklenecek ek fixture plugin JAR'ları (örn. hostile-probe). */
  readonly targetPluginPaths?: readonly string[];
}

export interface SmokeEvidence {
  readonly runtimeImageId: string;
  readonly serverInstanceId: string;
  readonly bridgeBootId: string;
  readonly bridgePort: number;
  readonly paperJarSha256: string;
  readonly bridgeJarSha256: string;
  readonly readyGateMs: number;
  readonly health: Record<string, unknown>;
  readonly capabilities: Record<string, unknown>;
  readonly serverState: Record<string, unknown>;
  readonly plugins: Record<string, unknown>;
  readonly worlds: Record<string, unknown>;
  readonly block: Record<string, unknown>;
  readonly events: ReadonlyArray<Record<string, unknown>>;
  readonly cleanup: {
    readonly graceful: boolean;
    readonly forceTerminated: boolean;
    readonly exitCode: number | null;
    readonly portReleased: boolean;
    readonly handshakeRemoved: boolean;
    readonly durationMs: number;
  };
  readonly unauthorizedRejected: boolean;
  readonly mutationRejected: boolean;
  readonly runtimeRoot: string;
}

export async function runM0Smoke(options: SmokeOptions): Promise<SmokeEvidence> {
  const log = options.log ?? (() => {});

  const profile = loadCompatibilityProfile(options.repoRoot, options.profileId);
  assertProfileUsable(profile, 'prototype');
  log(`profil: ${profile.id} (${profile.verification.status})`);

  const java = await resolveJavaForProfile(profile.java.runtime_major);
  log(`java  : ${java.versionString}`);

  const resolved = await resolveBuild(profile, globalThis.fetch);
  const jar = await downloadPaperJar(resolved, options.paperCacheDir, globalThis.fetch);
  log(`paper : build ${resolved.build} ${resolved.channel}, cache=${jar.fromCache}`);

  const serverInstanceId = `srv_${randomBytes(12).toString('hex')}`;
  const runtimeRoot = join(await mkdtemp(join(tmpdir(), 'mcpdev-rt-')), 'runtime');

  const image = await createRuntimeImage({
    runtimeRoot,
    serverInstanceId,
    paperJarPath: jar.path,
    bridgeJarPath: options.bridgeJarPath,
    ...(options.targetPluginPaths ? { targetPluginPaths: options.targetPluginPaths } : {}),
    profile,
    acceptMinecraftEula: options.acceptMinecraftEula,
  });
  log(`runtime: ${image.runtimeImageId}`);

  const startedAt = Date.now();
  const runtime = await launchPaper({
    image,
    javaExecutable: java.executable,
    startupTimeoutMs: options.startupTimeoutMs ?? 300_000,
  });
  const readyGateMs = Date.now() - startedAt;
  log(`ready  : ${readyGateMs} ms, bridge port ${runtime.handshake.port}`);

  try {
    const health = await runtime.client.health();
    const capabilities = await runtime.client.capabilities();
    const serverState = await runtime.client.query('server.get_state');
    const plugins = await runtime.client.query('plugin.list');
    const worlds = await runtime.client.query('world.list');

    // Blok okuma chunk YÜKLETMEZ; bu yüzden hedef, world.list'in bildirdiği
    // yüklü spawn konumundan seçilir. Yüklü chunk yoksa okuma denenmez ve
    // bu durum kanıta olduğu gibi yazılır.
    const worldEntries = (worlds['worlds'] ?? []) as Array<Record<string, unknown>>;
    const overworld =
      worldEntries.find((w) => w['world_key'] === 'minecraft:overworld') ?? worldEntries[0];

    let block: Record<string, unknown>;
    if (overworld?.['spawn_chunk_loaded'] === true) {
      block = await runtime.client.query('world.get_block', {
        world_key: overworld['world_key'],
        x: overworld['spawn_x'],
        y: overworld['spawn_y'],
        z: overworld['spawn_z'],
      });
    } else {
      block = { skipped: 'CHUNK_NOT_LOADED', reason: 'spawn chunk yüklü değil; okuma chunk yükletmez' };
    }

    const events = await runtime.client.events(runtime.handshake.bridge_boot_id, 0, 50);

    // Negatif kanıt 1: yanlış token reddedilmeli.
    const unauthorizedRejected = await expectUnauthorized(runtime.handshake.port);

    // Negatif kanıt 2: mutation query ucundan geçmemeli.
    const mutationRejected = await expectMutationRejected(runtime.client);

    const cleanup = await stopPaper(runtime);
    log(`cleanup: graceful=${cleanup.graceful} port_released=${cleanup.portReleased}`);

    return {
      runtimeImageId: image.runtimeImageId,
      serverInstanceId,
      bridgeBootId: runtime.handshake.bridge_boot_id,
      bridgePort: runtime.handshake.port,
      paperJarSha256: image.paperJarSha256,
      bridgeJarSha256: image.bridgeJarSha256,
      readyGateMs,
      health,
      capabilities,
      serverState,
      plugins,
      worlds,
      block,
      events,
      cleanup,
      unauthorizedRejected,
      mutationRejected,
      runtimeRoot,
    };
  } finally {
    // Terminal durum ne olursa olsun cleanup denenir (DSL-10 ruhu).
    if (runtime.process.exitCode === null && runtime.process.signalCode === null) {
      await stopPaper(runtime, 10_000).catch(() => undefined);
    }
    if (!options.keepRuntime) {
      await rm(runtimeRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function expectUnauthorized(port: number): Promise<boolean> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
    headers: { Authorization: 'Bearer wrong-token' },
    signal: AbortSignal.timeout(5000),
  });
  return response.status === 401;
}

async function expectMutationRejected(client: { query: (op: string) => Promise<unknown> }): Promise<boolean> {
  try {
    await client.query('world.set_block');
    return false;
  } catch {
    return true;
  }
}

export { isPortBound };
