/**
 * Scenario Evidence Collector Testleri.
 *
 * ScenarioEvidenceCollector'ın doğru çalışmasını doğrular.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioEvidenceCollector, type ScenarioEvidenceOptions } from '../src/scenario-evidence.js';
import type { StepResult, AssertionResult } from '../src/scenario-engine.js';

// ------------------------------------------------------------ Mock Evidence Store

interface MockStore {
  putCalls: Array<{ runId: string; kind: string; content: string }>;
  put: (request: { runId: string; kind: string; content: string; [key: string]: unknown }) => Promise<{ evidenceId: string }>;
}

function createMockStore(): MockStore {
  const store: MockStore = {
    putCalls: [],
    async put(request) {
      store.putCalls.push({ runId: request.runId, kind: request.kind, content: request.content });
      return { evidenceId: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
    },
  };
  return store;
}

function createTestOptions(overrides: Partial<ScenarioEvidenceOptions> = {}): ScenarioEvidenceOptions {
  return {
    scenarioRunId: 'sr_test_123',
    projectId: 'test-project',
    scenarioId: 'test-scenario',
    scenarioPath: '/test/scenario.yaml',
    version: '0.1.0',
    ...overrides,
  };
}

function createTestStepResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    stepName: 'assert.block',
    phase: 'then',
    index: 0,
    status: 'passed',
    durationMs: 100,
    ...overrides,
  };
}

// ------------------------------------------------------------ Testler

test('ScenarioEvidenceCollector: phase başlangıç ve tamamlama', () => {
  const store = createMockStore();
  const collector = new ScenarioEvidenceCollector(store as any, createTestOptions());

  collector.startPhase('given');
  // Phase tamamlanmadan önce step ekleyelim
  collector.addStepResult(createTestStepResult({ phase: 'given' }));
  collector.completePhase('given');

  assert.equal(collector.phases.length, 1);
  assert.equal(collector.phases[0]?.phase, 'given');
  assert.equal(collector.phases[0]?.steps.length, 1);
  assert.equal(collector.phases[0]?.passed, 1);
  assert.equal(collector.phases[0]?.failed, 0);
});

test('ScenarioEvidenceCollector: birden fazla phase', () => {
  const store = createMockStore();
  const collector = new ScenarioEvidenceCollector(store as any, createTestOptions());

  collector.startPhase('given');
  collector.completePhase('given');

  collector.startPhase('when');
  collector.completePhase('when');

  collector.startPhase('then');
  collector.completePhase('then');

  assert.equal(collector.phases.length, 3);
  assert.equal(collector.phases[0]?.phase, 'given');
  assert.equal(collector.phases[1]?.phase, 'when');
  assert.equal(collector.phases[2]?.phase, 'then');
});

test('ScenarioEvidenceCollector: step sonuçları', () => {
  const store = createMockStore();
  const collector = new ScenarioEvidenceCollector(store as any, createTestOptions());

  collector.startPhase('given');
  collector.addStepResult(createTestStepResult({ phase: 'given', status: 'passed' }));
  collector.addStepResult(createTestStepResult({ phase: 'given', status: 'failed', error: 'Test hatası' }));
  collector.addStepResult(createTestStepResult({ phase: 'given', status: 'skipped' }));
  collector.completePhase('given');

  const phase = collector.phases[0];
  assert.equal(phase?.steps.length, 3);
  assert.equal(phase?.passed, 1);
  assert.equal(phase?.failed, 1);
  assert.equal(phase?.skipped, 1);
});

test('ScenarioEvidenceCollector: assertion sonuçları', () => {
  const store = createMockStore();
  const collector = new ScenarioEvidenceCollector(store as any, createTestOptions());

  const assertion: AssertionResult = {
    stepName: 'assert.block',
    passed: true,
    message: 'Block assertion başarılı',
    expected: 'minecraft:stone',
    actual: 'minecraft:stone',
  };

  collector.addAssertionResult(assertion, 150, 3);

  assert.equal(collector.assertions.length, 1);
  assert.equal(collector.assertions[0]?.passed, true);
  assert.equal(collector.assertions[0]?.durationMs, 150);
  assert.equal(collector.assertions[0]?.attempts, 3);
});

test('ScenarioEvidenceCollector: flush evidence store\'a yazar', async () => {
  const store = createMockStore();
  const collector = new ScenarioEvidenceCollector(store as any, createTestOptions());

  collector.startPhase('given');
  collector.addStepResult(createTestStepResult({ phase: 'given' }));
  collector.completePhase('given');

  const startedAt = new Date('2026-01-01T00:00:00Z');
  const completedAt = new Date('2026-01-01T00:00:01Z');

  const evidenceIds = await collector.flush('sr_test_123', 'completed', startedAt, completedAt);

  assert.ok(evidenceIds.length > 0);
  assert.ok(store.putCalls.length > 0);
  assert.equal(store.putCalls[0]?.runId, 'sr_test_123');
});

test('ScenarioEvidenceCollector: flush scenario run evidence içerir', async () => {
  const store = createMockStore();
  const collector = new ScenarioEvidenceCollector(store as any, createTestOptions());

  collector.startPhase('given');
  collector.addStepResult(createTestStepResult({ phase: 'given', status: 'passed' }));
  collector.completePhase('given');

  collector.startPhase('then');
  collector.addStepResult(createTestStepResult({ phase: 'then', status: 'passed' }));
  collector.completePhase('then');

  await collector.flush('sr_test_123', 'completed', new Date(), new Date());

  // İlk put çağrısı scenario run evidence'ı olmalı
  const firstCall = store.putCalls[0];
  assert.ok(firstCall);
  
  const evidence = JSON.parse(firstCall.content);
  assert.equal(evidence.scenarioRunId, 'sr_test_123');
  assert.equal(evidence.status, 'completed');
  assert.equal(evidence.totalSteps, 2);
  assert.equal(evidence.totalPassed, 2);
  assert.equal(evidence.phases.length, 2);
});

test('ScenarioEvidenceCollector: flush assertion evidence\'ları ayrı yazar', async () => {
  const store = createMockStore();
  const collector = new ScenarioEvidenceCollector(store as any, createTestOptions());

  collector.startPhase('then');
  collector.addStepResult(createTestStepResult({ phase: 'then', status: 'passed' }));
  collector.completePhase('then');

  collector.addAssertionResult({
    stepName: 'assert.block',
    passed: true,
    message: 'Basarili',
  }, 100, 1);

  await collector.flush('sr_test_123', 'completed', new Date(), new Date());

  // En az 2 put çağrısı olmalı (1 scenario run + 1 assertion)
  assert.ok(store.putCalls.length >= 2);
});

test('ScenarioEvidenceCollector: flush hata yönetimi', async () => {
  const failingStore = {
    async put() {
      throw new Error('Store hatası');
    },
  };

  const collector = new ScenarioEvidenceCollector(failingStore as any, createTestOptions());
  collector.startPhase('given');
  collector.completePhase('given');

  // Hata fırlatmamalı
  const evidenceIds = await collector.flush('sr_test', 'completed', new Date(), new Date());
  assert.equal(evidenceIds.length, 0);
});

test('ScenarioEvidenceCollector: phases ve assertions getter', () => {
  const store = createMockStore();
  const collector = new ScenarioEvidenceCollector(store as any, createTestOptions());

  collector.startPhase('given');
  collector.addStepResult(createTestStepResult({ phase: 'given' }));
  collector.completePhase('given');

  collector.addAssertionResult({
    stepName: 'test',
    passed: true,
    message: 'test',
  }, 50, 1);

  assert.ok(Array.isArray(collector.phases));
  assert.ok(Array.isArray(collector.assertions));
  assert.equal(collector.phases.length, 1);
  assert.equal(collector.assertions.length, 1);
});
