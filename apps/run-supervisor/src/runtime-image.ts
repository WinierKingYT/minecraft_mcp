/**
 * Disposable runtime image kurucusu.
 *
 * docs/contracts/determinism.md: her scenario kendi runtime'ında çalışır.
 * Bu modül runtime kökünü hazırlar; süreç başlatma `runtime-launch.ts` işidir.
 *
 * Yazılan her şey runtime kökü ALTINDADIR; kök dışına hiçbir dosya
 * oluşturulmaz (security/controls.md FS-13).
 */

import { randomBytes, createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { CompatibilityProfile } from './compatibility.js';

/** Bridge'in yönetilen runtime'ı tanıması için aradığı marker. */
export const RUNTIME_MARKER_FILE = '.mcpdev-runtime';
export const BRIDGE_TOKEN_FILE = 'bridge-token';
export const HANDSHAKE_FILE = 'bridge-handshake.json';

export class RuntimeImageError extends Error {
  constructor(
    readonly code:
      | 'ARTIFACT_NOT_FOUND'
      | 'PAPER_JAR_CHECKSUM_INVALID'
      | 'EULA_NOT_ACCEPTED'
      | 'PATH_OUTSIDE_ROOT',
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeImageError';
  }
}

export interface DeterminismProfile {
  readonly onlineMode: boolean;
  readonly maxPlayers: number;
  readonly viewDistance: number;
  readonly simulationDistance: number;
  readonly spawnProtection: number;
  /** Spawn çevresinde yüklü tutulacak chunk yarıçapı (fixture okunabilirliği). */
  readonly spawnChunkRadius: number;
  readonly levelSeed: string;
  readonly difficulty: string;
}

export const DETERMINISTIC_DEFAULT_V1: DeterminismProfile = {
  // Bir güvenlik gevşetmesi değil, offline test identity gereğidir: runtime
  // ağa kapalıdır ve yalnızca loopback erişimi vardır.
  onlineMode: false,
  maxPlayers: 4,
  viewDistance: 4,
  simulationDistance: 4,
  spawnProtection: 0,
  spawnChunkRadius: 2,
  levelSeed: '123456789',
  difficulty: 'peaceful',
};

export interface RuntimeImageRequest {
  readonly runtimeRoot: string;
  readonly serverInstanceId: string;
  readonly paperJarPath: string;
  readonly bridgeJarPath: string;
  /** Hedef plugin JAR'ları; M0 demosunda boş olabilir. */
  readonly targetPluginPaths?: readonly string[];
  readonly profile: CompatibilityProfile;
  readonly determinism?: DeterminismProfile;
  /**
   * Fixture manifest'i (regions + allowed_materials). Verilirse runtime
   * köküne `mcpdev-fixture.json` olarak yazılır; Bridge dünya mutation'larını
   * (world.set_block, world.set_chunk_ticket) bu dosyadaki bölge/materyal
   * sınırlarına göre uygular. Yoksa dünya mutation'ları devre dışı kalır.
   */
  readonly fixtureManifest?: Readonly<Record<string, unknown>>;
  /**
   * Minecraft EULA kabulü.
   *
   * Ürün bunu KENDİLİĞİNDEN kabul etmez: eula.txt yazmak Mojang EULA'sını
   * kabul etmek anlamına gelir ve bu kullanıcının kararıdır. Yapılandırmada
   * açıkça etkinleştirilmeden runtime oluşturulamaz.
   */
  readonly acceptMinecraftEula: boolean;
}

export interface RuntimeImage {
  readonly runtimeImageId: string;
  readonly runtimeRoot: string;
  readonly serverInstanceId: string;
  readonly paperJarPath: string;
  readonly paperJarSha256: string;
  readonly bridgeJarSha256: string;
  readonly token: string;
  readonly tokenFile: string;
  readonly markerFile: string;
  readonly handshakeFile: string;
  readonly createdAt: string;
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

/** Yolun runtime kökü altında kaldığını kanıtlar (FS-03, FS-13). */
function assertInsideRoot(root: string, candidate: string): string {
  const canonicalRoot = resolve(root);
  const canonical = resolve(candidate);
  const rel = relative(canonicalRoot, canonical);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new RuntimeImageError('PATH_OUTSIDE_ROOT', `Yol runtime kökü dışında: ${candidate}`);
  }
  return canonical;
}

export async function createRuntimeImage(request: RuntimeImageRequest): Promise<RuntimeImage> {
  const {
    runtimeRoot,
    serverInstanceId,
    paperJarPath,
    bridgeJarPath,
    profile,
    acceptMinecraftEula,
  } = request;

  if (!acceptMinecraftEula) {
    throw new RuntimeImageError(
      'EULA_NOT_ACCEPTED',
      'Minecraft EULA kabul edilmeden runtime oluşturulamaz.\n' +
        'Önerilen aksiyon: operatörün `mcpdev eula accept` komutuyla EULA\'yı kabul etmesini sağlayın. ' +
        'Bu, https://aka.ms/MinecraftEULA adresindeki sözleşmeyi kabul ettiğiniz anlamına gelir ve ' +
        'ürün bu kararı sizin adınıza vermez.',
    );
  }

  for (const [label, path] of [
    ['Paper JAR', paperJarPath],
    ['Bridge JAR', bridgeJarPath],
  ] as const) {
    if (!existsSync(path)) {
      throw new RuntimeImageError('ARTIFACT_NOT_FOUND', `${label} bulunamadı: ${path}`);
    }
  }

  // Paper JAR checksum'ı HER runtime oluşturmada yeniden doğrulanır: cache
  // host üzerinde değiştirilmiş olabilir.
  const paperSha = await sha256File(paperJarPath);
  const expected = profile.paper.jar_sha256?.toLowerCase();
  if (expected && paperSha !== expected) {
    throw new RuntimeImageError(
      'PAPER_JAR_CHECKSUM_INVALID',
      `Paper JAR checksum'ı profildeki değerle eşleşmiyor.\n  beklenen: ${expected}\n  gerçek  : ${paperSha}`,
    );
  }

  const root = resolve(runtimeRoot);
  await mkdir(join(root, 'plugins'), { recursive: true });

  // Marker: Bridge ve Garbage Collector bu dizinin bize ait olduğunu buradan
  // anlar. Marker olmadan silme yapılmaz (FS-05, FS-06).
  const markerFile = assertInsideRoot(root, join(root, RUNTIME_MARKER_FILE));
  await writeFile(
    markerFile,
    JSON.stringify(
      { product: 'minecraft-plugin-dev-mcp', server_instance_id: serverInstanceId, created_at: new Date().toISOString() },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  // Token: Supervisor üretir, Bridge okur. Handshake dosyasına ASLA yazılmaz.
  const token = randomBytes(32).toString('hex');
  const tokenFile = assertInsideRoot(root, join(root, BRIDGE_TOKEN_FILE));
  await writeFile(tokenFile, token, { mode: 0o600 });

  await writeFile(join(root, 'eula.txt'), 'eula=true\n');

  const d = request.determinism ?? DETERMINISTIC_DEFAULT_V1;
  await writeFile(
    join(root, 'server.properties'),
    [
      '# Deterministik test runtime - elle duzenlemeyin',
      `online-mode=${d.onlineMode}`,
      `max-players=${d.maxPlayers}`,
      `view-distance=${d.viewDistance}`,
      `simulation-distance=${d.simulationDistance}`,
      `spawn-protection=${d.spawnProtection}`,
      // GEREKLİ FAKAT YETERLİ DEĞİL: Paper 26.2'de oyuncu yokken bu ayara
      // rağmen loaded_chunks 0 kalıyor. world.get_block chunk YÜKLETMEZ, bu
      // yüzden M2A'da fixture bölgesi açık chunk ticket'ı ile tutulacaktır.
      // Ölçüm kaydı: BOOTSTRAP-STATUS.md "Gerçek Paper bulgusu".
      `spawn-chunk-radius=${d.spawnChunkRadius}`,
      `level-seed=${d.levelSeed}`,
      `difficulty=${d.difficulty}`,
      'level-type=minecraft\\:flat',
      'generate-structures=false',
      'spawn-monsters=false',
      'spawn-npcs=false',
      'spawn-animals=false',
      'allow-nether=false',
      'enable-command-block=false',
      // Sunucu dışarıya açılmaz; yalnızca loopback.
      'server-ip=127.0.0.1',
      'server-port=0',
      'enable-status=false',
      'enable-rcon=false',
      'enable-query=false',
      'motd=mcpdev disposable runtime',
      '',
    ].join('\n'),
  );

  const bridgeSha = await sha256File(bridgeJarPath);
  await copyFile(bridgeJarPath, join(root, 'plugins', 'paper-bridge.jar'));

  // Fixture manifest'i Bridge'in dünya mutation'larını sınırlandırması için
  // runtime köküne yazılır (determinism.md: regions + allowed_materials).
  if (request.fixtureManifest) {
    await writeFile(
      join(root, 'mcpdev-fixture.json'),
      JSON.stringify(request.fixtureManifest, null, 2),
      { mode: 0o600 },
    );
  }

  for (const [index, pluginPath] of (request.targetPluginPaths ?? []).entries()) {
    if (!existsSync(pluginPath)) {
      throw new RuntimeImageError('ARTIFACT_NOT_FOUND', `Hedef plugin bulunamadı: ${pluginPath}`);
    }
    await copyFile(pluginPath, join(root, 'plugins', `target-${index}.jar`));
  }

  return {
    runtimeImageId: `rimg_${randomBytes(12).toString('hex')}`,
    runtimeRoot: root,
    serverInstanceId,
    paperJarPath: resolve(paperJarPath),
    paperJarSha256: paperSha,
    bridgeJarSha256: bridgeSha,
    token,
    tokenFile,
    markerFile,
    handshakeFile: join(root, HANDSHAKE_FILE),
    createdAt: new Date().toISOString(),
  };
}
