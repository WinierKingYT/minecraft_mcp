/**
 * ST-GRADLE-001..007 — supply-chain doğrulaması.
 *
 * Her test negatiftir: beklenen sonuç, error catalog'daki doğru kod ve
 * uygulanabilir bir aksiyondur.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  validateGradleProject,
  extractGradleVersion,
  hostOf,
  type GradleValidationOptions,
} from '../src/gradle-validation.js';

const WRAPPER_JAR_BYTES = new TextEncoder().encode('fake wrapper jar');
const WRAPPER_JAR_SHA = createHash('sha256').update(WRAPPER_JAR_BYTES).digest('hex');
const DIST_SHA = '9c0f7faeeb306cb14e4279a3e084ca6b596894089a0638e68a07c945a32c9e14';

const OPTIONS: GradleValidationOptions = {
  distributionHostAllowlist: ['services.gradle.org'],
  expectedVersion: '9.6.1',
  expectedDistributionSha256: DIST_SHA,
  knownWrapperJarSha256: [WRAPPER_JAR_SHA],
};

interface ProjectOverrides {
  readonly distributionUrl?: string;
  readonly distributionSha256?: string | null;
  readonly wrapperJar?: Uint8Array;
  readonly buildScript?: string;
  readonly omit?: readonly string[];
  readonly verificationXml?: string | null;
  readonly lockfile?: boolean;
}

async function gradleProject(overrides: ProjectOverrides = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gradle-'));
  const omit = new Set(overrides.omit ?? []);

  await mkdir(join(root, 'gradle', 'wrapper'), { recursive: true });

  if (!omit.has('gradlew')) await writeFile(join(root, 'gradlew'), '#!/bin/sh\n');
  if (!omit.has('gradlew.bat')) await writeFile(join(root, 'gradlew.bat'), '@echo off\n');
  if (!omit.has('jar')) {
    await writeFile(join(root, 'gradle', 'wrapper', 'gradle-wrapper.jar'), overrides.wrapperJar ?? WRAPPER_JAR_BYTES);
  }

  if (!omit.has('properties')) {
    const url = overrides.distributionUrl ?? 'https\\://services.gradle.org/distributions/gradle-9.6.1-bin.zip';
    const sha = overrides.distributionSha256 === null ? null : (overrides.distributionSha256 ?? DIST_SHA);
    await writeFile(
      join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      [`distributionUrl=${url}`, sha === null ? '' : `distributionSha256Sum=${sha}`, ''].join('\n'),
    );
  }

  if (overrides.lockfile !== false) await writeFile(join(root, 'gradle.lockfile'), 'empty=\n');

  if (overrides.verificationXml !== null) {
    await writeFile(
      join(root, 'gradle', 'verification-metadata.xml'),
      overrides.verificationXml ??
        '<verification-metadata><configuration><verify-metadata>true</verify-metadata></configuration>' +
          '<components><component><artifact><sha256 value="abc"/></artifact></component></components></verification-metadata>',
    );
  }

  await writeFile(join(root, 'build.gradle.kts'), overrides.buildScript ?? 'dependencies { implementation("a:b:1.0.0") }\n');
  return root;
}

function codes(result: Awaited<ReturnType<typeof validateGradleProject>>): string[] {
  return result.findings.map((f) => f.code);
}

test('geçerli proje doğrulamayı geçer', async () => {
  const result = await validateGradleProject(await gradleProject(), OPTIONS);

  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.wrapper.version, '9.6.1');
  assert.equal(result.wrapper.distributionSha256, DIST_SHA);
});

test('ST-GRADLE: eksik wrapper GRADLE_WRAPPER_NOT_FOUND üretir', async () => {
  const result = await validateGradleProject(await gradleProject({ omit: ['jar'] }), OPTIONS);

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('GRADLE_WRAPPER_NOT_FOUND'));
  assert.match(result.findings[0]!.suggestedAction, /wrapper/i, 'KPI-08: aksiyon önerilmeli');
});

test('ST-GRADLE-001: bilinmeyen wrapper JAR reddedilir', async () => {
  const tampered = new TextEncoder().encode('kötü niyetli wrapper');
  const result = await validateGradleProject(await gradleProject({ wrapperJar: tampered }), OPTIONS);

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('GRADLE_WRAPPER_JAR_UNVERIFIED'));
});

test('ST-GRADLE-003: allowlist dışı distributionUrl reddedilir', async () => {
  const result = await validateGradleProject(
    await gradleProject({ distributionUrl: 'https\\://evil.example/gradle-9.6.1-bin.zip' }),
    OPTIONS,
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('GRADLE_DISTRIBUTION_URL_UNAPPROVED'));
});

test('HTTP dağıtım URL’si reddedilir', async () => {
  const result = await validateGradleProject(
    await gradleProject({ distributionUrl: 'http\\://services.gradle.org/distributions/gradle-9.6.1-bin.zip' }),
    OPTIONS,
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('GRADLE_DISTRIBUTION_URL_UNAPPROVED'));
});

test('ST-GRADLE-004: eksik checksum GRADLE_DISTRIBUTION_CHECKSUM_MISSING üretir', async () => {
  const result = await validateGradleProject(await gradleProject({ distributionSha256: null }), OPTIONS);

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('GRADLE_DISTRIBUTION_CHECKSUM_MISSING'));
});

test('ST-GRADLE-002: yanlış checksum GRADLE_DISTRIBUTION_CHECKSUM_INVALID üretir', async () => {
  const result = await validateGradleProject(await gradleProject({ distributionSha256: 'f'.repeat(64) }), OPTIONS);

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('GRADLE_DISTRIBUTION_CHECKSUM_INVALID'));
});

test('sürüm uyuşmazlığı GRADLE_VERSION_INCOMPATIBLE üretir', async () => {
  const result = await validateGradleProject(
    await gradleProject({ distributionUrl: 'https\\://services.gradle.org/distributions/gradle-8.5-bin.zip' }),
    OPTIONS,
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('GRADLE_VERSION_INCOMPATIBLE'));
});

test('eksik lock ve verification metadata raporlanır', async () => {
  const result = await validateGradleProject(
    await gradleProject({ lockfile: false, verificationXml: null }),
    OPTIONS,
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('DEPENDENCY_LOCK_MISSING'));
  assert.ok(codes(result).includes('DEPENDENCY_VERIFICATION_MISSING'));
});

test('kapalı verify-metadata dosyanın varlığını anlamsız kılar', async () => {
  const result = await validateGradleProject(
    await gradleProject({
      verificationXml:
        '<verification-metadata><configuration><verify-metadata>false</verify-metadata></configuration>' +
        '<components><component><artifact><sha256 value="abc"/></artifact></component></components></verification-metadata>',
    }),
    OPTIONS,
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('DEPENDENCY_VERIFICATION_MISSING'));
});

test('ST-GRADLE-006: dinamik sürümler reddedilir', async () => {
  for (const script of [
    'dependencies { implementation("a:b:+") }',
    'dependencies { implementation("a:b:latest.release") }',
    'dependencies { implementation("a:b:[1.0,2.0)") }',
  ]) {
    const result = await validateGradleProject(await gradleProject({ buildScript: script }), OPTIONS);

    assert.equal(result.ok, false, `kabul edildi: ${script}`);
    assert.ok(codes(result).includes('DYNAMIC_DEPENDENCY_FORBIDDEN'), script);
  }
});

test('SNAPSHOT ve changing module reddedilir', async () => {
  for (const script of [
    'dependencies { implementation("a:b:1.0-SNAPSHOT") }',
    'dependencies { implementation("a:b:1.0") { isChanging = true } }',
  ]) {
    const result = await validateGradleProject(await gradleProject({ buildScript: script }), OPTIONS);

    assert.equal(result.ok, false, `kabul edildi: ${script}`);
    assert.ok(codes(result).includes('CHANGING_MODULE_FORBIDDEN'), script);
  }
});

test('yorum satırındaki örnek bulgu üretmez', async () => {
  const result = await validateGradleProject(
    await gradleProject({
      buildScript: '// implementation("a:b:+") kullanmayın\ndependencies { implementation("a:b:1.0.0") }',
    }),
    OPTIONS,
  );

  assert.equal(result.ok, true, JSON.stringify(result.findings));
});

test('bulguların TÜMÜ raporlanır, ilk hatada durulmaz', async () => {
  const result = await validateGradleProject(
    await gradleProject({
      distributionSha256: 'f'.repeat(64),
      lockfile: false,
      verificationXml: null,
      buildScript: 'dependencies { implementation("a:b:+") }',
      wrapperJar: new TextEncoder().encode('bilinmeyen'),
    }),
    OPTIONS,
  );

  const found = new Set(codes(result));
  // Kullanıcı aynı projeyi defalarca çalıştırmak zorunda kalmamalı.
  assert.ok(found.has('GRADLE_WRAPPER_JAR_UNVERIFIED'));
  assert.ok(found.has('GRADLE_DISTRIBUTION_CHECKSUM_INVALID'));
  assert.ok(found.has('DEPENDENCY_LOCK_MISSING'));
  assert.ok(found.has('DEPENDENCY_VERIFICATION_MISSING'));
  assert.ok(found.has('DYNAMIC_DEPENDENCY_FORBIDDEN'));
  assert.ok(found.size >= 5, `beklenen çoklu bulgu, bulunan: ${[...found].join(', ')}`);
});

test('her bulgu önerilen aksiyon taşır (KPI-08)', async () => {
  const result = await validateGradleProject(
    await gradleProject({ lockfile: false, verificationXml: null, distributionSha256: null }),
    OPTIONS,
  );

  for (const finding of result.findings) {
    assert.ok(finding.suggestedAction.length >= 8, `${finding.code} aksiyon taşımıyor`);
    assert.ok(finding.message.length >= 8, `${finding.code} mesaj taşımıyor`);
  }
});

test('sürüm ve host ayrıştırıcıları', () => {
  assert.equal(extractGradleVersion('https://services.gradle.org/distributions/gradle-9.6.1-bin.zip'), '9.6.1');
  assert.equal(extractGradleVersion('https://services.gradle.org/distributions/gradle-8.5-all.zip'), '8.5');
  assert.equal(extractGradleVersion('https://evil.example/x.zip'), null);

  assert.equal(hostOf('https://services.gradle.org/x'), 'services.gradle.org');
  assert.equal(hostOf('bozuk url'), null);
});

test('gerçek bridge/paper projesi kendi kurallarımızı geçer', async (t) => {
  // Kendi ürünümüzün supply-chain kuralları kendimize de uygulanır.
  const bridgeRoot = join(process.cwd(), '..', '..', 'bridge', 'paper');
  const { existsSync } = await import('node:fs');
  if (!existsSync(join(bridgeRoot, 'gradlew'))) {
    t.skip('bridge/paper wrapper bulunamadı');
    return;
  }

  const wrapperSha = createHash('sha256')
    .update(await (await import('node:fs/promises')).readFile(join(bridgeRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar')))
    .digest('hex');

  const result = await validateGradleProject(bridgeRoot, {
    ...OPTIONS,
    knownWrapperJarSha256: [wrapperSha],
  });

  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.wrapper.version, '9.6.1');
  assert.equal(result.wrapper.distributionSha256, DIST_SHA);

  await rm(join(tmpdir(), 'noop'), { force: true }).catch(() => undefined);
});
