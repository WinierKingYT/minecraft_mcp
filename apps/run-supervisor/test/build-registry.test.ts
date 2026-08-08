/**
 * UT-BUILD-REGISTRY-001 — Build Registry artifact çözümleme kapıları.
 *
 * plugin_launch yalnızca build_id alır; artifact Supervisor'da çözümlenir ve
 * launch anında sha256 yeniden doğrulanır. Her kapı ayrı hata kodu taşır
 * (KPI-08): kayıt yok → BUILD_NOT_FOUND, build başarısız/artifact yok →
 * ARTIFACT_NOT_FOUND, dosya değişmiş → ARTIFACT_INTEGRITY_MISMATCH.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { BuildRegistry, BuildRegistryError } from '../src/build-registry.js';

const BYTES = new TextEncoder().encode('plugin jar');
const SHA = createHash('sha256').update(BYTES).digest('hex');

function record(overrides: Record<string, unknown> = {}) {
  return {
    buildId: 'run_abc',
    projectId: 'demo',
    mode: 'build',
    backend: 'container' as const,
    status: 'completed' as const,
    artifactPath: null,
    artifactSha256: null,
    artifactRelativePath: null,
    evidenceIds: [],
    durationMs: 1000,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function jarFixture(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'buildreg-'));
  const path = join(base, 'demo-1.0.0.jar');
  await writeFile(path, BYTES);
  return path;
}

describe('BuildRegistry', () => {
  test('resolveArtifact kayıtlı artifacti doğrulanmış biçimde döner', async () => {
    const path = await jarFixture();
    const registry = new BuildRegistry();
    registry.record(record({ artifactPath: path, artifactSha256: SHA, artifactRelativePath: 'build/libs/demo.jar' }));

    const resolved = await registry.resolveArtifact('run_abc');

    assert.equal(resolved.path, path);
    assert.equal(resolved.sha256, SHA);
    assert.equal(resolved.relativePath, 'build/libs/demo.jar');
  });

  test('kayıt yoksa BUILD_NOT_FOUND üretir', async () => {
    const registry = new BuildRegistry();
    await assert.rejects(
      () => registry.resolveArtifact('run_yok'),
      (err: unknown) => {
        assert.ok(err instanceof BuildRegistryError);
        assert.equal(err.code, 'BUILD_NOT_FOUND');
        return true;
      },
    );
  });

  test('başarısız buildin artifacti çözümlenemez', async () => {
    const registry = new BuildRegistry();
    registry.record(record({ status: 'failed', artifactPath: null, artifactSha256: null }));

    await assert.rejects(
      () => registry.resolveArtifact('run_abc'),
      (err: unknown) => {
        assert.ok(err instanceof BuildRegistryError);
        assert.equal(err.code, 'ARTIFACT_NOT_FOUND');
        assert.match(err.message, /artifact üretmedi/);
        return true;
      },
    );
  });

  test('artifact dosyası silinmişse ARTIFACT_NOT_FOUND', async () => {
    const registry = new BuildRegistry();
    registry.record(
      record({ artifactPath: join(tmpdir(), 'yok-olmayan.jar'), artifactSha256: SHA }),
    );

    await assert.rejects(
      () => registry.resolveArtifact('run_abc'),
      (err: unknown) => {
        assert.ok(err instanceof BuildRegistryError);
        assert.equal(err.code, 'ARTIFACT_NOT_FOUND');
        assert.match(err.message, /yerinde değil/);
        return true;
      },
    );
  });

  test('dosya kayıt anındaki sha256 ile eşleşmiyorsa ARTIFACT_INTEGRITY_MISMATCH', async () => {
    const path = await jarFixture();
    await writeFile(path, new TextEncoder().encode('değiştirilmiş içerik'));
    const registry = new BuildRegistry();
    registry.record(record({ artifactPath: path, artifactSha256: SHA }));

    await assert.rejects(
      () => registry.resolveArtifact('run_abc'),
      (err: unknown) => {
        assert.ok(err instanceof BuildRegistryError);
        assert.equal(err.code, 'ARTIFACT_INTEGRITY_MISMATCH');
        return true;
      },
    );
  });

  test('get kayıt meta verisini döndürür; olmayan için null', () => {
    const registry = new BuildRegistry();
    registry.record(record());
    assert.ok(registry.get('run_abc'));
    assert.equal(registry.get('run_yok'), null);
  });
});
