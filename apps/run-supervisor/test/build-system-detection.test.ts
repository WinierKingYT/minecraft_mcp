/**
 * ST-BUILD-SYS-001/002 — build sistemi tespiti (explicit detection).
 *
 * Ürün yalnızca wrapper-pinned build sistemlerini destekler; dört durum
 * sessiz varsayım olmadan ayrılır. `service.projectValidate` bu fonksiyonu
 * kullanır ve `not-found`/`ambiguous` durumlarını sırasıyla
 * BUILD_SYSTEM_NOT_FOUND / BUILD_SYSTEM_AMBIGUOUS hata koduna çevirir
 * (apps/run-supervisor/src/service.ts).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectBuildSystem } from '../src/build-system-detection.js';

let n = 0;
async function root(markers: string[]): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), 'bsys-')), `p${n++}`);
  await mkdir(dir, { recursive: true });
  for (const name of markers) await writeFile(join(dir, name), '');
  return dir;
}

test('yalnızca Gradle wrapper varsa gradle döner', async () => {
  assert.deepEqual(await detectBuildSystem(await root(['gradlew'])), { state: 'gradle' });
});

test('yalnızca gradlew.bat varsa gradle döner', async () => {
  assert.deepEqual(await detectBuildSystem(await root(['gradlew.bat'])), { state: 'gradle' });
});

test('yalnızca Maven wrapper varsa maven döner', async () => {
  assert.deepEqual(await detectBuildSystem(await root(['mvnw'])), { state: 'maven' });
});

test('yalnızca mvnw.cmd varsa maven döner', async () => {
  assert.deepEqual(await detectBuildSystem(await root(['mvnw.cmd'])), { state: 'maven' });
});

// ST-BUILD-SYS-001: hiçbir wrapper yoksa sessizce Gradle varsayılmaz.
test('ST-BUILD-SYS-001: hiçbir wrapper yoksa not-found döner (sessiz varsayım yok)', async () => {
  const empty = await root([]);
  assert.deepEqual(await detectBuildSystem(empty), { state: 'not-found' });

  // İlgisiz dosyalar (pom.xml / build.gradle kalsın) tespiti değiştirmez.
  const withBuildFiles = await root(['pom.xml', 'build.gradle.kts']);
  assert.deepEqual(await detectBuildSystem(withBuildFiles), { state: 'not-found' });
});

// ST-BUILD-SYS-002: iki wrapper birden varsa mvnw önceliğiyle sessizce
// Maven seçilmez; conflict explicit hale gelir.
test('ST-BUILD-SYS-002: hem Gradle hem Maven wrapper varsa ambiguous döner', async () => {
  const both = await root(['gradlew', 'mvnw']);
  assert.deepEqual(await detectBuildSystem(both), { state: 'ambiguous' });

  const bothCmd = await root(['gradlew.bat', 'mvnw.cmd']);
  assert.deepEqual(await detectBuildSystem(bothCmd), { state: 'ambiguous' });
});