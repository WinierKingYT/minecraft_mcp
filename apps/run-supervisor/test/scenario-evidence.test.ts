/**
 * Scenario Evidence Collector testleri — evidence provenance zinciri.
 *
 * docs/contracts/evidence.md: scenario_run_id -> evidence_id[] halkası
 * collector tarafından doldurulur; her evidence content-addressed store'a
 * redaction sonrası hash ile yazılır ve okumada checksum yeniden doğrulanır.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore } from '@mcpdev/evidence-model';
import { ScenarioEvidenceCollector, type ScenarioEvidenceOptions } from '../src/scenario-evidence.js';

const baseOptions: ScenarioEvidenceOptions = {
  scenarioRunId: 'sr_test_1',
  projectId: 'proj_test',
  scenarioId: 'read-block',
  scenarioPath: 'scenarios/world/read-block.yaml',
  version: '0.1.0',
};

async function withStore(fn: (store: EvidenceStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'evidence-collector-test-'));
  try {
    await fn(new EvidenceStore(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('collector: flush run + assertion evidence yazar, producer runtime bilgisi taşır', async () => {
  await withStore(async (store) => {
    const collector = new ScenarioEvidenceCollector(store, baseOptions);
    collector.setRuntimeInfo('rimg_test_1', 'boot_test_1');

    collector.startPhase('given');
    collector.addStepResult({
      stepName: 'world.set_chunk_ticket',
      phase: 'given',
      index: 0,
      status: 'passed',
      durationMs: 181,
    });
    collector.completePhase('given');

    collector.startPhase('then');
    collector.addStepResult({
      stepName: 'assert.block',
      phase: 'then',
      index: 0,
      status: 'passed',
      durationMs: 11,
      attempts: 1,
    });
    collector.addAssertionResult(
      { stepName: 'assert.block', passed: true, message: 'Assertion başarılı.' },
      11,
      1,
    );
    collector.completePhase('then');

    const ids = await collector.flush(
      'sr_test_1',
      'completed',
      new Date('2026-08-08T10:00:00Z'),
      new Date('2026-08-08T10:00:01Z'),
    );

    // 1 run-level + 1 assertion-level evidence
    assert.equal(ids.length, 2);
    assert.ok(ids.every((id) => id.startsWith('ev_')));

    // Okuma checksum doğrulamasından geçmeli
    const runManifest = await store.getManifest(ids[0]!);
    assert.equal(runManifest.kind, 'assertion-result');
    assert.equal(runManifest.producer.component, 'run-supervisor');
    assert.equal(runManifest.producer.serverInstanceId, 'rimg_test_1');
    assert.equal(runManifest.producer.bridgeBootId, 'boot_test_1');
    assert.equal(runManifest.scenarioRunId, 'sr_test_1');

    const { text } = await store.get(ids[0]!);
    const parsed = JSON.parse(text) as { runtimeImageId: string; bridgeBootId: string; totalPassed: number };
    assert.equal(parsed.runtimeImageId, 'rimg_test_1');
    assert.equal(parsed.bridgeBootId, 'boot_test_1');
    assert.equal(parsed.totalPassed, 2);
  });
});

test("collector: assertion failed evidence'ı message ve attempts ile yazılır", async () => {
  await withStore(async (store) => {
    const collector = new ScenarioEvidenceCollector(store, baseOptions);
    collector.setRuntimeInfo('rimg_test_1', 'boot_test_1');

    collector.startPhase('then');
    collector.addStepResult({
      stepName: 'assert.event',
      phase: 'then',
      index: 0,
      status: 'failed',
      durationMs: 5000,
      error: 'Assertion assert.event süre aşımı (5000ms)',
      attempts: 10,
    });
    collector.addAssertionResult(
      { stepName: 'assert.event', passed: false, message: 'Assertion assert.event süre aşımı (5000ms)' },
      5000,
      10,
    );
    collector.completePhase('then');

    const ids = await collector.flush(
      'sr_test_1',
      'failed',
      new Date('2026-08-08T10:00:00Z'),
      new Date('2026-08-08T10:00:06Z'),
    );

    const assertionManifest = await store.getManifest(ids[1]!);
    const { text } = await store.get(ids[1]!);
    const parsed = JSON.parse(text) as { stepName: string; passed: boolean; attempts: number; durationMs: number };
    assert.equal(parsed.stepName, 'assert.event');
    assert.equal(parsed.passed, false);
    assert.equal(parsed.attempts, 10);
    assert.equal(parsed.durationMs, 5000);
    assert.equal(assertionManifest.retention.expiresAt > assertionManifest.retention.createdAt, true);
  });
});

test('collector: runtime bilgisi verilmezse producer yalnızca component/version taşır', async () => {
  await withStore(async (store) => {
    const collector = new ScenarioEvidenceCollector(store, baseOptions);
    collector.startPhase('then');
    collector.addAssertionResult({ stepName: 'assert.no_log', passed: true, message: 'ok' }, 14, 1);
    collector.completePhase('then');

    const ids = await collector.flush(
      'sr_test_1',
      'completed',
      new Date('2026-08-08T10:00:00Z'),
      new Date('2026-08-08T10:00:01Z'),
    );

    const manifest = await store.getManifest(ids[0]!);
    assert.equal(manifest.producer.serverInstanceId, undefined);
    assert.equal(manifest.producer.bridgeBootId, undefined);
  });
});

test('collector: secret içeren içerik redaction sonrası saklanır (no raw secret)', async () => {
  await withStore(async (store) => {
    const collector = new ScenarioEvidenceCollector(store, baseOptions);
    collector.startPhase('then');
    collector.addAssertionResult(
      { stepName: 'assert.block', passed: false, message: 'token=abc123secretvalue' },
      5,
      2,
    );
    collector.completePhase('then');

    const ids = await collector.flush(
      'sr_test_1',
      'failed',
      new Date('2026-08-08T10:00:00Z'),
      new Date('2026-08-08T10:00:01Z'),
    );

    const { text } = await store.get(ids[0]!);
    assert.ok(!text.includes('abc123secretvalue'), 'raw secret redaction ile maskelenmeli');
    assert.ok(text.includes('[REDACTED]'));
  });
});
