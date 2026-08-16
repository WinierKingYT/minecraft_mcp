/**
 * ST-MAVEN-001..006 — Maven Wrapper supply-chain doğrulaması.
 *
 * Gradle testlerinin (ST-GRADLE-*) birebir karşılığıdır. Her test negatiftir:
 * beklenen sonuç, error catalog'daki doğru kod ve uygulanabilir bir aksiyondur.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  validateMavenProject,
  extractMavenVersion,
  hostOf,
  type MavenValidationOptions,
} from '../src/maven-validation.js';

const WRAPPER_JAR_BYTES = new TextEncoder().encode('fake wrapper jar');
const WRAPPER_JAR_SHA = createHash('sha256').update(WRAPPER_JAR_BYTES).digest('hex');
const DIST_SHA = '13c72e8e33d0c4d84a0f6d0a4f9c9f4d1e1a7c2a1b0e5f6d7c8b9a0f1e2d3c4b5';

const DIST_URL = 'https\\://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.9/apache-maven-3.9.9-bin.zip';

const OPTIONS: MavenValidationOptions = {
  distributionHostAllowlist: ['repo.maven.apache.org'],
  expectedVersion: '3.9.9',
  expectedDistributionSha256: DIST_SHA,
  knownWrapperJarSha256: [WRAPPER_JAR_SHA],
};

interface ProjectOverrides {
  readonly distributionUrl?: string;
  readonly distributionSha256?: string | null;
  readonly wrapperJar?: Uint8Array;
  readonly omit?: readonly string[];
  readonly pomXml?: string;
  readonly wrapperJarAbsent?: boolean;
}

async function mavenProject(overrides: ProjectOverrides = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'maven-'));
  const omit = new Set(overrides.omit ?? []);

  await mkdir(join(root, '.mvn', 'wrapper'), { recursive: true });

  if (!omit.has('mvnw')) await writeFile(join(root, 'mvnw'), '#!/bin/sh\n');
  if (!omit.has('mvnw.cmd')) await writeFile(join(root, 'mvnw.cmd'), '@echo off\n');
  if (!omit.has('jar') && !overrides.wrapperJarAbsent) {
    await writeFile(join(root, '.mvn', 'wrapper', 'maven-wrapper.jar'), overrides.wrapperJar ?? WRAPPER_JAR_BYTES);
  }

  if (!omit.has('properties')) {
    const url = overrides.distributionUrl ?? DIST_URL;
    const sha = overrides.distributionSha256 === null ? null : (overrides.distributionSha256 ?? DIST_SHA);
    await writeFile(
      join(root, '.mvn', 'wrapper', 'maven-wrapper.properties'),
      [
        'wrapperVersion=3.3.2',
        'distributionType=only-script',
        `distributionUrl=${url}`,
        sha === null ? '' : `distributionSha256Sum=${sha}`,
        '',
      ].join('\n'),
    );
  }

  await writeFile(
    join(root, 'pom.xml'),
    overrides.pomXml ?? '<project><dependencies><dependency><artifactId>a</artifactId><version>1.0.0</version></dependency></dependencies></project>\n',
  );
  return root;
}

function codes(result: Awaited<ReturnType<typeof validateMavenProject>>): string[] {
  return result.findings.map((f) => f.code);
}

test('geçerli Maven projesi doğrulamayı geçer', async () => {
  const result = await validateMavenProject(await mavenProject(), OPTIONS);

  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.wrapper.version, '3.9.9');
  assert.equal(result.wrapper.distributionSha256, DIST_SHA);
  assert.equal(result.wrapper.wrapperJarPresent, true);
});

test('ST-MAVEN-001: eksik wrapper MVN_WRAPPER_NOT_FOUND üretir', async () => {
  const result = await validateMavenProject(await mavenProject({ omit: ['jar', 'mvnw'] }), OPTIONS);

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('MVN_WRAPPER_NOT_FOUND'));
  assert.match(result.findings[0]!.suggestedAction, /wrapper/i, 'KPI-08: aksiyon önerilmeli');
});

test('ST-MAVEN-002: bilinmeyen wrapper JAR reddedilir', async () => {
  const tampered = new TextEncoder().encode('kötü niyetli wrapper');
  const result = await validateMavenProject(await mavenProject({ wrapperJar: tampered }), OPTIONS);

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('MVN_WRAPPER_JAR_UNVERIFIED'));
});

test('only-script modunda JAR yokluğu bulgu üretmez', async () => {
  // maven-wrapper 3.2+ distributionType=only-script: JAR projede bulunmayabilir.
  const result = await validateMavenProject(await mavenProject({ wrapperJarAbsent: true }), OPTIONS);

  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.wrapper.wrapperJarPresent, false);
});

test('ST-MAVEN-003: allowlist dışı distributionUrl reddedilir', async () => {
  const result = await validateMavenProject(
    await mavenProject({ distributionUrl: 'https\\://evil.example/apache-maven-3.9.9-bin.zip' }),
    OPTIONS,
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('MVN_DISTRIBUTION_URL_UNAPPROVED'));
});

test('HTTP dağıtım URL’si reddedilir', async () => {
  const result = await validateMavenProject(
    await mavenProject({
      distributionUrl: 'http\\://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.9/apache-maven-3.9.9-bin.zip',
    }),
    OPTIONS,
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('MVN_DISTRIBUTION_URL_UNAPPROVED'));
});

test('ST-MAVEN-004: eksik checksum MVN_DISTRIBUTION_CHECKSUM_MISSING üretir', async () => {
  const result = await validateMavenProject(await mavenProject({ distributionSha256: null }), OPTIONS);

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('MVN_DISTRIBUTION_CHECKSUM_MISSING'));
});

test('ST-MAVEN-005: yanlış checksum MVN_DISTRIBUTION_CHECKSUM_INVALID üretir', async () => {
  const result = await validateMavenProject(await mavenProject({ distributionSha256: 'f'.repeat(64) }), OPTIONS);

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('MVN_DISTRIBUTION_CHECKSUM_INVALID'));
});

test('ST-MAVEN-006: sürüm uyuşmazlığı MVN_VERSION_INCOMPATIBLE üretir', async () => {
  const result = await validateMavenProject(
    await mavenProject({
      distributionUrl: 'https\\://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.8.8/apache-maven-3.8.8-bin.zip',
    }),
    OPTIONS,
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('MVN_VERSION_INCOMPATIBLE'));
});

test('pom.xml dinamik sürümler reddedilir', async () => {
  for (const pom of [
    '<project><dependency><version>[1.0,2.0)</version></dependency></project>',
    '<project><dependency><version>LATEST</version></dependency></project>',
    '<project><dependency><version>RELEASE</version></dependency></project>',
    '<project><dependency><version>1.2.+</version></dependency></project>',
  ]) {
    const result = await validateMavenProject(await mavenProject({ pomXml: pom }), OPTIONS);

    assert.equal(result.ok, false, `kabul edildi: ${pom}`);
    assert.ok(codes(result).includes('DYNAMIC_DEPENDENCY_FORBIDDEN'), pom);
  }
});

test('pom.xml SNAPSHOT bağımlılığı reddedilir', async () => {
  const result = await validateMavenProject(
    await mavenProject({ pomXml: '<project><dependency><version>1.0.0-SNAPSHOT</version></dependency></project>' }),
    OPTIONS,
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('CHANGING_MODULE_FORBIDDEN'));
});

test('XML yorum satırındaki örnek bulgu üretmez', async () => {
  const result = await validateMavenProject(
    await mavenProject({
      pomXml: '<!-- <version>[1.0,2.0)</version> kullanmayın -->\n<project><dependency><version>1.0.0</version></dependency></project>',
    }),
    OPTIONS,
  );

  assert.equal(result.ok, true, JSON.stringify(result.findings));
});

test('bulguların TÜMÜ raporlanır, ilk hatada durulmaz', async () => {
  const result = await validateMavenProject(
    await mavenProject({
      distributionSha256: 'f'.repeat(64),
      wrapperJar: new TextEncoder().encode('bilinmeyen'),
      pomXml: '<project><dependency><version>1.0.0-SNAPSHOT</version></dependency></project>',
    }),
    OPTIONS,
  );

  const found = new Set(codes(result));
  // Kullanıcı aynı projeyi defalarca çalıştırmak zorunda kalmamalı.
  assert.ok(found.has('MVN_WRAPPER_JAR_UNVERIFIED'));
  assert.ok(found.has('MVN_DISTRIBUTION_CHECKSUM_INVALID'));
  assert.ok(found.has('CHANGING_MODULE_FORBIDDEN'));
  assert.ok(found.size >= 3, `beklenen çoklu bulgu, bulunan: ${[...found].join(', ')}`);
});

test('her bulgu önerilen aksiyon taşır (KPI-08)', async () => {
  const result = await validateMavenProject(
    await mavenProject({ distributionSha256: null, wrapperJar: new TextEncoder().encode('bilinmeyen') }),
    OPTIONS,
  );

  for (const finding of result.findings) {
    assert.ok(finding.suggestedAction.length >= 8, `${finding.code} aksiyon taşımıyor`);
    assert.ok(finding.message.length >= 8, `${finding.code} mesaj taşımıyor`);
  }
});

test('sürüm ve host ayrıştırıcıları', () => {
  assert.equal(
    extractMavenVersion('https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.9/apache-maven-3.9.9-bin.zip'),
    '3.9.9',
  );
  assert.equal(
    extractMavenVersion('https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.8.8/apache-maven-3.8.8-bin.zip'),
    '3.8.8',
  );
  assert.equal(extractMavenVersion('https://evil.example/x.zip'), null);

  assert.equal(hostOf('https://repo.maven.apache.org/x'), 'repo.maven.apache.org');
  assert.equal(hostOf('bozuk url'), null);
});
