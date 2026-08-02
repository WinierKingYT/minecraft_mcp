/**
 * UT-BUILD-PLAN-001, UT-ARTIFACT-SELECT-001, ST-ENV-001, ST-OUTPUT-001
 *
 * Build hattının saf parçaları. Gerçek Gradle koşusu ayrı bir dogfood
 * testindedir (uzun sürer, ayrı çalıştırılır).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuildPlan, supportedModes, BuildPlanError } from '../src/build-plan.js';
import { selectArtifact, findArtifactCandidates, ArtifactError } from '../src/artifact-selection.js';
import { parseDiagnostics, suggestAction } from '../src/diagnostics.js';
import {
  prepareEnvironment,
  assertEnvironmentClean,
  buildCommand,
  wrapperJarPath,
  GRADLE_WRAPPER_MAIN,
  BuildExecutionError,
  DANGEROUS_ENV_VARS,
} from '../src/trusted-local-backend.js';

// ------------------------------------------------------------------ build plan

test('desteklenen modlar enum ile sınırlıdır', () => {
  assert.deepEqual([...supportedModes()].sort(), ['build', 'clean_build', 'integration_test', 'unit_test']);
});

test('bilinmeyen mod BUILD_MODE_UNSUPPORTED üretir', () => {
  assert.throws(
    () => createBuildPlan({ mode: 'rm -rf /' as never }),
    (err: unknown) => {
      assert.ok(err instanceof BuildPlanError);
      assert.equal(err.code, 'BUILD_MODE_UNSUPPORTED');
      assert.match(err.message, /Serbest Gradle task verilemez/);
      return true;
    },
  );
});

test('offline mod --offline bayrağı taşır', () => {
  const plan = createBuildPlan({ mode: 'build' });

  assert.equal(plan.network, 'offline', 'güvenli varsayılan ağ kapalıdır');
  assert.ok(plan.args.includes('--offline'));
  assert.ok(plan.args.includes('--no-daemon'), 'daemon sahiplik takibini bozar');
  assert.ok(plan.args.includes('assemble'));
});

test('ağ erişimi açık kullanıcı onayı ister', () => {
  assert.throws(
    () => createBuildPlan({ mode: 'build', network: 'repository-allowlist' }),
    (err: unknown) => err instanceof BuildPlanError && err.code === 'PROVISIONING_APPROVAL_REQUIRED',
  );

  const approved = createBuildPlan({ mode: 'build', network: 'repository-allowlist', provisioningApproved: true });
  assert.equal(approved.args.includes('--offline'), false);
});

test('clean_build clean ve assemble çalıştırır', () => {
  const plan = createBuildPlan({ mode: 'clean_build' });
  assert.deepEqual(
    plan.args.filter((a) => !a.startsWith('--')),
    ['clean', 'assemble'],
  );
});

// ------------------------------------------------------------- artifact seçimi

async function projectWithJars(names: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'artifact-'));
  await mkdir(join(root, 'build', 'libs'), { recursive: true });
  for (const name of names) {
    await writeFile(join(root, 'build', 'libs', name), `jar:${name}`);
  }
  return root;
}

test('tek aday deterministik olarak seçilir', async () => {
  const root = await projectWithJars(['claim-plugin-1.0.0.jar']);

  const artifact = await selectArtifact(root);

  assert.equal(artifact.path, 'build/libs/claim-plugin-1.0.0.jar');
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
  assert.match(artifact.buildArtifactId, /^bart_[0-9a-f]{24}$/);
});

test('sources ve javadoc JAR’ları aday değildir', async () => {
  const root = await projectWithJars([
    'claim-plugin-1.0.0.jar',
    'claim-plugin-1.0.0-sources.jar',
    'claim-plugin-1.0.0-javadoc.jar',
    'claim-plugin-1.0.0-tests.jar',
  ]);

  const candidates = await findArtifactCandidates(root);
  assert.equal(candidates.length, 1);

  const artifact = await selectArtifact(root);
  assert.equal(artifact.path, 'build/libs/claim-plugin-1.0.0.jar');
});

test('birden fazla aday ARTIFACT_AMBIGUOUS üretir', async () => {
  // "En yenisini seç" gibi bir kural, kaynak değişmeden farklı artifact
  // seçilmesine yol açar ve provenance zincirini yalancı yapar.
  const root = await projectWithJars(['a-1.0.0.jar', 'b-1.0.0.jar']);

  await assert.rejects(
    () => selectArtifact(root),
    (err: unknown) => {
      assert.ok(err instanceof ArtifactError);
      assert.equal(err.code, 'ARTIFACT_AMBIGUOUS');
      assert.deepEqual(err.candidates, ['build/libs/a-1.0.0.jar', 'build/libs/b-1.0.0.jar']);
      return true;
    },
  );
});

test('test contract belirsizliği çözebilir', async () => {
  const root = await projectWithJars(['a-1.0.0.jar', 'b-1.0.0.jar']);

  const artifact = await selectArtifact(root, { expectedFileName: 'b-1.0.0.jar' });
  assert.equal(artifact.path, 'build/libs/b-1.0.0.jar');
});

test('beklenen dosya yoksa ARTIFACT_NOT_FOUND', async () => {
  const root = await projectWithJars(['a-1.0.0.jar']);

  await assert.rejects(
    () => selectArtifact(root, { expectedFileName: 'yok.jar' }),
    (err: unknown) => err instanceof ArtifactError && err.code === 'ARTIFACT_NOT_FOUND',
  );
});

test('hiç aday yoksa ARTIFACT_NOT_FOUND ve aksiyon önerilir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artifact-'));

  await assert.rejects(
    () => selectArtifact(root),
    (err: unknown) => {
      assert.ok(err instanceof ArtifactError);
      assert.equal(err.code, 'ARTIFACT_NOT_FOUND');
      assert.match(err.message, /Önerilen aksiyon/);
      return true;
    },
  );
});

// ---------------------------------------------------------------- diagnostics

test('javac hatası dosya, satır ve sembolle ayrıştırılır', () => {
  const root = process.platform === 'win32' ? 'C:\\proj' : '/proj';
  const output = [
    `> Task :compileJava FAILED`,
    `${root}${process.platform === 'win32' ? '\\' : '/'}src${process.platform === 'win32' ? '\\' : '/'}App.java:12: error: cannot find symbol`,
    `        foo();`,
    `        ^`,
    `  symbol:   method foo()`,
  ].join('\n');

  const summary = parseDiagnostics(output, root);

  assert.equal(summary.errors, 1);
  assert.deepEqual(summary.failedTasks, [':compileJava']);

  const diagnostic = summary.diagnostics[0]!;
  assert.equal(diagnostic.path, 'src/App.java', 'yol köke göre göreli ve POSIX olmalı');
  assert.equal(diagnostic.line, 12);
  assert.equal(diagnostic.message, 'cannot find symbol');
  assert.equal(diagnostic.symbol, 'method foo()');
  assert.match(suggestAction(diagnostic), /method foo\(\)/);
});

test('kök dışındaki host yolu rapora sızmaz', () => {
  const root = process.platform === 'win32' ? 'C:\\proj' : '/proj';
  const outside = process.platform === 'win32' ? 'C:\\Users\\gizli\\Other.java' : '/home/gizli/Other.java';

  const summary = parseDiagnostics(`${outside}:3: error: boom`, root);

  assert.equal(summary.diagnostics[0]!.path, null, 'host dizin yapısı sızdırılmamalı');
});

test('uyarılar hatalardan ayrılır', () => {
  const root = process.platform === 'win32' ? 'C:\\proj' : '/proj';
  const sep = process.platform === 'win32' ? '\\' : '/';
  const output = [
    `${root}${sep}A.java:1: warning: [deprecation] eski API`,
    `${root}${sep}B.java:2: error: incompatible types`,
  ].join('\n');

  const summary = parseDiagnostics(output, root);

  assert.equal(summary.errors, 1);
  assert.equal(summary.warnings, 1);
});

test('önerilen aksiyon içi boş değildir', () => {
  const cases = [
    'cannot find symbol',
    'package org.bukkit does not exist',
    'incompatible types: String cannot be converted to int',
    'unreported exception IOException',
    'bilinmeyen bir hata',
  ];

  for (const message of cases) {
    const action = suggestAction({ severity: 'error', path: null, line: null, column: null, message, symbol: null });
    assert.ok(action.length >= 12, `"${message}" için yetersiz aksiyon: ${action}`);
    assert.doesNotMatch(action, /^tekrar deneyin\.?$/i, 'içi boş öneri kabul edilmez');
  }
});

// ------------------------------------------------------------------- ortam

test('build ortamı yalnızca allowlist değişkenlerini taşır', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'env-'));

  const environment = await prepareEnvironment(workDir, {
    PATH: '/usr/bin',
    JAVA_HOME: '/opt/java',
    // Bunlar build'e keyfî JVM argümanı enjekte etmenin bilinen yollarıdır.
    GRADLE_OPTS: '-Dfoo=bar',
    JAVA_TOOL_OPTIONS: '-javaagent:evil.jar',
    _JAVA_OPTIONS: '-Xmx1g',
    AWS_SECRET_ACCESS_KEY: 'gizli',
  });

  assert.equal(environment.env['PATH'], '/usr/bin');
  assert.equal(environment.env['JAVA_HOME'], '/opt/java');
  assert.equal(environment.env['GRADLE_OPTS'], undefined);
  assert.equal(environment.env['JAVA_TOOL_OPTIONS'], undefined);
  assert.equal(environment.env['_JAVA_OPTIONS'], undefined);
  assert.equal(environment.env['AWS_SECRET_ACCESS_KEY'], undefined, 'host secret aktarılmamalı');
});

test('HOME ve GRADLE_USER_HOME runtime’a özeldir', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'env-'));
  const environment = await prepareEnvironment(workDir, { PATH: '/usr/bin' });

  assert.ok(environment.env['GRADLE_USER_HOME']?.startsWith(workDir), 'kullanıcının cache’i kirletilmemeli');
  assert.ok(environment.env['HOME']?.startsWith(workDir));
  assert.ok(environment.env['USERPROFILE']?.startsWith(workDir));
  assert.equal(environment.env['TZ'], 'UTC', 'determinizm için sabit');
});

test('tehlikeli değişken sızarsa build reddedilir', () => {
  assert.throws(
    () => assertEnvironmentClean({ PATH: '/usr/bin', JAVA_TOOL_OPTIONS: '-javaagent:evil.jar' }),
    (err: unknown) => {
      assert.ok(err instanceof BuildExecutionError);
      assert.equal(err.code, 'ENVIRONMENT_VARIABLE_NOT_ALLOWED');
      return true;
    },
  );

  assert.doesNotThrow(() => assertEnvironmentClean({ PATH: '/usr/bin', GRADLE_USER_HOME: '/tmp/x' }));
  assert.ok(DANGEROUS_ENV_VARS.includes('JAVA_TOOL_OPTIONS'));
});

test('build komutu gradlew script’ini DEĞİL, doğrulanmış wrapper JAR’ını çalıştırır', () => {
  // gradlew.bat çalıştırmak Windows'ta shell gerektirirdi; shell ise proje
  // yolundaki bir metakarakteri komut enjeksiyonuna çevirir (PR-01).
  const plan = createBuildPlan({ mode: 'build' });
  const { command, args } = buildCommand('/proj', '/opt/java/bin/java', plan);

  assert.equal(command, '/opt/java/bin/java', 'Java profille sabitlenmiş olmalı');
  assert.equal(args[0], '-classpath');
  assert.equal(args[1], wrapperJarPath('/proj'));
  assert.equal(args[2], GRADLE_WRAPPER_MAIN);
  assert.ok(args.includes('assemble'));

  assert.equal(
    args.some((a) => a.endsWith('gradlew') || a.endsWith('gradlew.bat')),
    false,
    'wrapper script çalıştırılmamalı',
  );
});

test('build argümanlarında shell metakarakteri yorumlanmaz', () => {
  // Argümanlar diziyle geçtiği için tırnak/metakarakter kaçırma sorunu yoktur.
  // (path.join yol sonundaki ayırıcıyı normalize eder; metakarakterler kalır.)
  const plan = createBuildPlan({ mode: 'build' });
  const { args } = buildCommand('/proj & del /q *', '/opt/java/bin/java', plan);

  assert.ok(args[1]?.includes('& del'), 'yol tek bir argüman olarak taşınır');
  assert.equal(
    args.some((a) => a === '&' || a === '&&' || a === '|'),
    false,
    'metakarakterler ayrı argümana bölünmemeli',
  );
});
