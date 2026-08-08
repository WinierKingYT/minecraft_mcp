/**
 * ST-CONTAINER-EXEC-* — Container execution backend birim testleri.
 *
 * Docker CLI gerektirmez: `execImpl` mock ile argüman üretimi ve artifact
 * toplama davranışı doğrulanır. Canlı Docker doğrulaması
 * `spike-container-check.ts`'tedir.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContainerBackend, ContainerBuildEnvironment, type ContainerRunResult } from '../src/container-backend.js';
import { ContainerExecutionBackend } from '../src/container-execution-backend.js';
import { createBuildPlan } from '../src/build-plan.js';

function mockRun(): { backend: ContainerBackend; capturedArgs: string[][] } {
  const capturedArgs: string[][] = [];
  const backend = new ContainerBackend({
    execImpl: (args) => {
      capturedArgs.push([...args]);
      return Promise.resolve({
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 1,
        timedOut: false,
      } satisfies ContainerRunResult);
    },
  });
  return { backend, capturedArgs };
}

describe('ST-CONTAINER-EXEC-001: Build copy-in modeli', () => {
  test('build() kaynağı /output/src kopyasına taşır ve komutu orada çalıştırır', async () => {
    const { backend, capturedArgs } = mockRun();
    const buildDir = await mkdtemp(join(tmpdir(), 'mcpdev-t-build-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'mcpdev-t-out-'));

    try {
      const env = new ContainerBuildEnvironment(backend, buildDir, outputDir);
      const result = await env.build('p1', ['./gradlew', 'assemble', '--no-daemon', '--offline']);

      assert.equal(result.exitCode, 0);
      const args = capturedArgs[0]!;
      assert.ok(args.includes('--workdir') && args[args.indexOf('--workdir') + 1] === '/output/src', 'workdir kopya dizini olmalıdır');
      assert.ok(args.includes(`${buildDir}:/src:ro`), 'kaynak /src ro mount edilmelidir');
      assert.ok(args.some((a) => a.includes('cp -a /src/. /output/src/')), 'kaynak kopya adımı komutta olmalıdır');
      assert.ok(args.some((a) => a.includes("exec './gradlew'")), 'komut kopya üzerinde exec edilmelidir');
      assert.ok(args.some((a) => a.includes('--offline')), 'offline bayrağı taşınmalıdır');
    } finally {
      await rm(buildDir, { recursive: true, force: true }).catch(() => undefined);
      await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

describe('ST-CONTAINER-EXEC-002: runBuild artifact collect', () => {
  test('exit 0 + output libs JAR → artifact seçilir', async () => {
    const { backend } = mockRun();
    const projectRoot = await mkdtemp(join(tmpdir(), 'mcpdev-t-proj-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'mcpdev-t-out-'));

    try {
      await mkdir(join(outputDir, 'src', 'build', 'libs'), { recursive: true });
      await writeFile(join(outputDir, 'src', 'build', 'libs', 'demo-plugin.jar'), 'jar-content', 'utf8');

      const exec = new ContainerExecutionBackend({ backend });
      const plan = createBuildPlan({ mode: 'build' });
      const result = await exec.runBuild(plan, { projectId: 'p1', projectRoot, outputDir });

      assert.equal(result.exitCode, 0);
      assert.ok(result.artifact, 'artifact seçilmelidir');
      assert.equal(result.artifact?.buildArtifactId.startsWith('bart_'), true);
      assert.equal(result.artifact?.path, 'src/build/libs/demo-plugin.jar');
    } finally {
      await rm(projectRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('exit 1 → artifact null, çıktı iletilir', async () => {
    const backend = new ContainerBackend({
      execImpl: () =>
        Promise.resolve({
          exitCode: 1,
          stdout: 'FAILURE: Build failed',
          stderr: '',
          durationMs: 1,
          timedOut: false,
        } satisfies ContainerRunResult),
    });
    const projectRoot = await mkdtemp(join(tmpdir(), 'mcpdev-t-proj-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'mcpdev-t-out-'));

    try {
      const exec = new ContainerExecutionBackend({ backend });
      const result = await exec.runBuild(createBuildPlan({ mode: 'build' }), {
        projectId: 'p1',
        projectRoot,
        outputDir,
      });

      assert.notEqual(result.exitCode, 0);
      assert.equal(result.artifact, null);
      assert.match(result.output, /Build failed/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

describe('ST-CONTAINER-EXEC-003: execution environment id', () => {
  test('prepareSource benzersiz exe_ id üretir', () => {
    const exec = new ContainerExecutionBackend();
    const a = exec.prepareSource();
    const b = exec.prepareSource();
    assert.match(a.executionEnvironmentId, /^exe_[0-9a-f]+$/);
    assert.notEqual(a.executionEnvironmentId, b.executionEnvironmentId);
  });
});

describe('ST-CONTAINER-EXEC-004: runBuild cache seed + offline argümanları', () => {
  test('plan.args + dependencyCacheDir ro mount ve seed adımı', async () => {
    const { backend, capturedArgs } = mockRun();
    const projectRoot = await mkdtemp(join(tmpdir(), 'mcpdev-t-proj-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'mcpdev-t-out-'));
    const cacheDir = await mkdtemp(join(tmpdir(), 'mcpdev-t-cache-'));

    try {
      await mkdir(join(outputDir, 'src', 'build', 'libs'), { recursive: true });
      await writeFile(join(outputDir, 'src', 'build', 'libs', 'demo-plugin.jar'), 'jar-content', 'utf8');

      const exec = new ContainerExecutionBackend({ backend, dependencyCacheDir: cacheDir });
      const plan = createBuildPlan({ mode: 'build' });
      await exec.runBuild(plan, { projectId: 'p1', projectRoot, outputDir });

      const args = capturedArgs[0]!;
      const shell = args[args.indexOf('sh') + 2] ?? '';
      assert.ok(shell.includes('assemble'), 'plan.args task listesi taşınmalıdır');
      assert.ok(shell.includes('--offline'), 'offline default network');
      assert.ok(args.includes('GRADLE_USER_HOME=/output/.gradle'), 'GRADLE_USER_HOME kopyaya işaret etmelidir');
      assert.ok(args.includes(`${cacheDir}:/cache:ro`), 'dependency cache ro mount edilmeli');
      assert.ok(shell.includes('tar -C /cache'), 'cache seed adımı komutta olmalıdır');
      assert.ok(shell.includes('--exclude=*.lock'), 'lock dosyaları kopyaya taşınmaz');
      assert.ok(args.includes(`${projectRoot}:/src:ro`), 'kaynak ro mount');
      assert.ok(args.includes('--network') && args[args.indexOf('--network') + 1] === 'none');
    } finally {
      await rm(projectRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
      await rm(cacheDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
