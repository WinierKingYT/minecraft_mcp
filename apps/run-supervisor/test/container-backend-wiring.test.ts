/**
 * UT-BACKEND-WIRING-001 — container backend bağlantısı.
 *
 * BuildExecutor `request.backend === 'container'` olduğunda:
 * - container seçeneği yoksa BACKEND_UNAVAILABLE döner (M1 öncesi davranış),
 * - container sağlanırsa istek container'ın runBuild'ine delege edilir ve
 *   artifact container'ın seçimiyle raporlanır.
 *
 * Gerçek Docker kullanılmaz; backend sahte (fake) implementasyondur.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { BuildExecutor } from '../src/build-executor.js';
import { ProjectRegistry } from '../src/project-registry.js';
import type { ContainerExecutionBackend } from '../src/container-execution-backend.js';
import type { SelectedArtifact } from '../src/artifact-selection.js';

const execFileAsync = promisify(execFile);

/**
 * Windows'ta temp yolu 8.3 kısa forma canonicalize olabilir
 * (runneradmin -> RUNNER~1). Test expected değeri de gerçek uygulamadaki
 * gibi realpath ile canonicalize edilmelidir (P0-3).
 */
async function canonical(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

const WRAPPER_JAR_SHA = createHash('sha256').update(new TextEncoder().encode('fake wrapper jar')).digest('hex');
const DIST_SHA = '9c0f7faeeb306cb14e4279a3e084ca6b596894089a0638e68a07c945a32c9e14';

async function gitInit(root: string): Promise<void> {
  await execFileAsync('git', ['init', '-q'], { cwd: root });
  await execFileAsync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: root });
  await execFileAsync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: root });
}

async function validProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wire-proj-'));
  await mkdir(join(root, 'gradle', 'wrapper'), { recursive: true });
  await writeFile(join(root, 'gradlew'), '#!/bin/sh\n');
  await writeFile(join(root, 'gradlew.bat'), '@echo off\n');
  await writeFile(
    join(root, 'gradle', 'wrapper', 'gradle-wrapper.jar'),
    new TextEncoder().encode('fake wrapper jar'),
  );
  await writeFile(
    join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
    `distributionUrl=https\\://services.gradle.org/distributions/gradle-9.6.1-bin.zip\ndistributionSha256Sum=${DIST_SHA}\n`,
  );
  await writeFile(join(root, 'gradle.lockfile'), 'empty=\n');
  await writeFile(
    join(root, 'gradle', 'verification-metadata.xml'),
    '<verification-metadata><configuration><verify-metadata>true</verify-metadata></configuration>' +
      '<components><component><artifact><sha256 value="abc"/></artifact></component></components></verification-metadata>',
  );
  await writeFile(join(root, 'build.gradle.kts'), 'dependencies { implementation("a:b:1.0.0") }\n');
  await gitInit(root);
  return root;
}

function executorOptions(registry: ProjectRegistry) {
  return {
    registry,
    gradleValidation: {
      distributionHostAllowlist: ['services.gradle.org'],
      expectedVersion: '9.6.1',
      expectedDistributionSha256: DIST_SHA,
      knownWrapperJarSha256: [WRAPPER_JAR_SHA],
      requireLockAndVerification: true,
    },
    javaMajor: 25,
    artifactStoreDir: join(tmpdir(), 'mcpdev-test-artifacts'),
  };
}

test('container isteği + backend yoksa BACKEND_UNAVAILABLE döner', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'wire-proj-'));
  const registry = new ProjectRegistry();
  await registry.register('demo', {
    canonicalRoot: projectRoot,
    trustLevel: 'developer-workspace',
    allowedBackends: ['trusted-local', 'container'],
    defaultBackend: 'trusted-local',
  });
  const executor = new BuildExecutor(executorOptions(registry));

  const outcome = await executor.execute({
    projectId: 'demo',
    mode: 'build',
    backend: 'container',
    network: 'offline',
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.failure?.code, 'BACKEND_UNAVAILABLE');
  assert.match(outcome.failure?.message ?? '', /yapılandırılmadı/);
});

test('container isteği backende delege edilir; artifact container seçimiyle raporlanır', async () => {
  const projectRoot = await validProject();
  const registry = new ProjectRegistry();
  await registry.register('demo', {
    canonicalRoot: projectRoot,
    trustLevel: 'developer-workspace',
    allowedBackends: ['trusted-local', 'container'],
    defaultBackend: 'trusted-local',
  });

  const captured: { context: { projectId: string; projectRoot: string; outputDir: string } | null } = {
    context: null,
  };
  const artifact: SelectedArtifact = {
    path: 'src/build/libs/demo-1.0.0.jar',
    absolutePath: join(projectRoot, 'build', 'libs', 'demo-1.0.0.jar'),
    sha256: 'c'.repeat(64),
    byteSize: 42,
    buildArtifactId: 'bart_aaaaaaaaaaaaaaaaaaaaaaaa',
  };
  await mkdir(dirname(artifact.absolutePath), { recursive: true });
  await writeFile(artifact.absolutePath, 'demo-jar-content');
  const fakeBackend = {
    runBuild: async (_plan: unknown, context: { projectId: string; projectRoot: string; outputDir: string }) => {
      captured.context = context;
      return { exitCode: 0, output: 'BUILD SUCCESSFUL', timedOut: false, artifact };
    },
  } as unknown as ContainerExecutionBackend;

  const executor = new BuildExecutor({
    ...executorOptions(registry),
    container: fakeBackend,
  });

  const outcome = await executor.execute({
    projectId: 'demo',
    mode: 'build',
    backend: 'container',
    network: 'offline',
  });

  assert.equal(outcome.ok, true, JSON.stringify(outcome.failure, null, 2));
  assert.ok(captured.context, 'runBuild çağrılmış olmalı');
  assert.equal(captured.context!.projectId, 'demo');
  assert.equal(captured.context!.projectRoot, await canonical(projectRoot));
  assert.ok(captured.context!.outputDir.includes('output'));
  assert.equal(outcome.artifact?.buildArtifactId, artifact.buildArtifactId);
  assert.equal(outcome.provenance?.backend, 'container');
});

test('backend izinli değilse container isteği TRUST_LEVEL_INSUFFICIENT üretir', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'wire-proj-'));
  const registry = new ProjectRegistry();
  await registry.register('demo', {
    canonicalRoot: projectRoot,
    trustLevel: 'developer-workspace',
    allowedBackends: ['trusted-local'],
    defaultBackend: 'trusted-local',
  });
  const executor = new BuildExecutor(executorOptions(registry));

  await assert.rejects(
    () =>
      executor.execute({
        projectId: 'demo',
        mode: 'build',
        backend: 'container',
        network: 'offline',
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /izinli değil/);
      return true;
    },
  );
});
