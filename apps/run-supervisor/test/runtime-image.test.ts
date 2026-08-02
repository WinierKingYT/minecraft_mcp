/**
 * CT-RUNTIME-CREATE-001 — runtime image kurulumu.
 *
 * Gerçek Paper GEREKTİRMEZ: JAR'lar sahte dosyalarla temsil edilir. Amaç,
 * güvenlik davranışlarını kilitlemek — özellikle EULA kapısı, checksum
 * yeniden doğrulaması ve token/handshake ayrımı.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  createRuntimeImage,
  RuntimeImageError,
  RUNTIME_MARKER_FILE,
  BRIDGE_TOKEN_FILE,
} from '../src/runtime-image.js';
import type { CompatibilityProfile } from '../src/compatibility.js';

const PAPER_BYTES = new TextEncoder().encode('fake paper jar');
const PAPER_SHA = createHash('sha256').update(PAPER_BYTES).digest('hex');

async function fixture(): Promise<{ root: string; paperJar: string; bridgeJar: string; profile: CompatibilityProfile }> {
  const base = await mkdtemp(join(tmpdir(), 'rt-image-'));
  const paperJar = join(base, 'paper.jar');
  const bridgeJar = join(base, 'bridge.jar');
  await writeFile(paperJar, PAPER_BYTES);
  await writeFile(bridgeJar, new TextEncoder().encode('fake bridge jar'));

  const profile = {
    id: 'test-profile',
    verification: { status: 'verified' },
    minecraft: { version: '26.2' },
    paper: {
      channel: 'STABLE',
      build: 84,
      api_coordinate: 'io.papermc.paper:paper-api:26.2.build.84-stable',
      api_version: '26.2',
      jar_sha256: PAPER_SHA,
      hardcoded_download_url_allowed: false,
    },
    java: { runtime_major: 25, toolchain_major: 25 },
    node: { version: '24.18.1' },
    gradle: { wrapper_version: '9.6.1', distribution_sha256: null },
    mcp: { protocol_version: '2026-07-28', transport: 'stdio' },
    protocols: { bridge: 1 },
  } as CompatibilityProfile;

  return { root: join(base, 'runtime'), paperJar, bridgeJar, profile };
}

test('EULA kabul edilmeden runtime oluşturulamaz', async () => {
  const { root, paperJar, bridgeJar, profile } = await fixture();

  await assert.rejects(
    () =>
      createRuntimeImage({
        runtimeRoot: root,
        serverInstanceId: 'srv_test',
        paperJarPath: paperJar,
        bridgeJarPath: bridgeJar,
        profile,
        acceptMinecraftEula: false,
      }),
    (err: unknown) => {
      assert.ok(err instanceof RuntimeImageError);
      assert.equal(err.code, 'EULA_NOT_ACCEPTED');
      assert.match(err.message, /Önerilen aksiyon/, 'KPI-08: hata önerilen aksiyon taşımalı');
      return true;
    },
  );

  assert.equal(existsSync(root), false, 'reddedilen istek hiçbir dosya oluşturmamalı');
});

test('kabul edildiğinde runtime kökü marker ve token ile kurulur', async () => {
  const { root, paperJar, bridgeJar, profile } = await fixture();

  const image = await createRuntimeImage({
    runtimeRoot: root,
    serverInstanceId: 'srv_test',
    paperJarPath: paperJar,
    bridgeJarPath: bridgeJar,
    profile,
    acceptMinecraftEula: true,
  });

  assert.ok(existsSync(join(root, RUNTIME_MARKER_FILE)), 'marker dosyası zorunlu (FS-05)');
  assert.ok(existsSync(join(root, BRIDGE_TOKEN_FILE)));
  assert.ok(existsSync(join(root, 'eula.txt')));
  assert.ok(existsSync(join(root, 'server.properties')));
  assert.ok(existsSync(join(root, 'plugins', 'paper-bridge.jar')));

  assert.equal(image.paperJarSha256, PAPER_SHA);
  assert.match(image.runtimeImageId, /^rimg_[0-9a-f]{24}$/);
  assert.equal(image.token.length, 64, 'token 32 bayt hex olmalı');
});

test('token yalnızca token dosyasındadır, başka hiçbir dosyada geçmez', async () => {
  const { root, paperJar, bridgeJar, profile } = await fixture();

  const image = await createRuntimeImage({
    runtimeRoot: root,
    serverInstanceId: 'srv_test',
    paperJarPath: paperJar,
    bridgeJarPath: bridgeJar,
    profile,
    acceptMinecraftEula: true,
  });

  for (const name of await readdir(root)) {
    if (name === BRIDGE_TOKEN_FILE || name === 'plugins') continue;
    const content = await readFile(join(root, name), 'utf8').catch(() => '');
    assert.equal(content.includes(image.token), false, `${name} token içermemeli (BR-05)`);
  }
});

test('Paper JAR checksum uyuşmazsa runtime kurulmaz', async () => {
  const { root, paperJar, bridgeJar, profile } = await fixture();
  // Cache host üzerinde değiştirilmiş gibi davran.
  await writeFile(paperJar, new TextEncoder().encode('tampered'));

  await assert.rejects(
    () =>
      createRuntimeImage({
        runtimeRoot: root,
        serverInstanceId: 'srv_test',
        paperJarPath: paperJar,
        bridgeJarPath: bridgeJar,
        profile,
        acceptMinecraftEula: true,
      }),
    (err: unknown) => err instanceof RuntimeImageError && err.code === 'PAPER_JAR_CHECKSUM_INVALID',
  );
});

test('eksik artifact açık hata üretir', async () => {
  const { root, paperJar, profile } = await fixture();

  await assert.rejects(
    () =>
      createRuntimeImage({
        runtimeRoot: root,
        serverInstanceId: 'srv_test',
        paperJarPath: paperJar,
        bridgeJarPath: join(root, 'yok.jar'),
        profile,
        acceptMinecraftEula: true,
      }),
    (err: unknown) => err instanceof RuntimeImageError && err.code === 'ARTIFACT_NOT_FOUND',
  );
});

test('server.properties determinizm ve loopback ayarlarını taşır', async () => {
  const { root, paperJar, bridgeJar, profile } = await fixture();

  await createRuntimeImage({
    runtimeRoot: root,
    serverInstanceId: 'srv_test',
    paperJarPath: paperJar,
    bridgeJarPath: bridgeJar,
    profile,
    acceptMinecraftEula: true,
  });

  const properties = await readFile(join(root, 'server.properties'), 'utf8');

  assert.match(properties, /online-mode=false/);
  assert.match(properties, /server-ip=127\.0\.0\.1/, 'sunucu dışarıya açılmamalı');
  assert.match(properties, /enable-rcon=false/, 'serbest RCON kalıcı non-goal');
  assert.match(properties, /enable-query=false/);
  assert.match(properties, /spawn-monsters=false/);
  assert.match(properties, /level-seed=123456789/);
});
