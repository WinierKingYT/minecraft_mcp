/**
 * Scenario Evidence Collector.
 *
 * Scenario çalışırken kanıt toplar ve evidence store'a yazar.
 * Her step, assertion ve phase için ayrı evidence üretir.
 */

import type { EvidenceStore } from '@mcpdev/evidence-model';
import type { StepResult, AssertionResult } from './scenario-engine.js';

export interface ScenarioEvidenceOptions {
  readonly scenarioRunId: string;
  readonly projectId: string;
  readonly scenarioId: string;
  readonly scenarioPath: string;
  readonly version: string;
}

export interface StepEvidence {
  readonly stepName: string;
  readonly phase: 'given' | 'when' | 'then' | 'cleanup';
  readonly index: number;
  readonly status: 'passed' | 'failed' | 'skipped' | 'error';
  readonly durationMs: number;
  readonly error?: string;
  readonly suggestedAction?: string;
  readonly bridgeRequest?: {
    readonly operation: string;
    readonly args: Record<string, unknown>;
    readonly result?: Record<string, unknown>;
    readonly error?: string;
  };
}

export interface PhaseEvidence {
  readonly phase: 'given' | 'when' | 'then' | 'cleanup';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly steps: readonly StepEvidence[];
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface ScenarioRunEvidence {
  readonly scenarioRunId: string;
  readonly scenarioId: string;
  readonly scenarioPath: string;
  readonly projectId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly status: 'completed' | 'failed' | 'timed_out';
  readonly phases: readonly PhaseEvidence[];
  readonly totalSteps: number;
  readonly totalPassed: number;
  readonly totalFailed: number;
  readonly totalSkipped: number;
  readonly assertions: readonly AssertionEvidence[];
}

export interface AssertionEvidence {
  readonly stepName: string;
  readonly passed: boolean;
  readonly message: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly durationMs: number;
  readonly attempts: number;
}

/**
 * Scenario Evidence Collector.
 *
 * Scenario çalışması boyunca kanıt toplar.
 */
export class ScenarioEvidenceCollector {
  readonly #store: EvidenceStore;
  readonly #options: ScenarioEvidenceOptions;
  readonly #phases: PhaseEvidence[] = [];
  readonly #assertions: AssertionEvidence[] = [];
  readonly #evidenceIds: string[] = [];
  #currentSteps: StepEvidence[] = [];
  #phaseStartedAt: Date | null = null;

  constructor(store: EvidenceStore, options: ScenarioEvidenceOptions) {
    this.#store = store;
    this.#options = options;
  }

  /**
   * Yeni bir phase başlatır.
   */
  startPhase(phase: 'given' | 'when' | 'then' | 'cleanup'): void {
    this.#phaseStartedAt = new Date();
    this.#currentSteps = [];
    this.#log('INFO', 'scenario.phase_started', { phase });
  }

  /**
   * Mevcut phase'i tamamlar.
   */
  completePhase(phase: 'given' | 'when' | 'then' | 'cleanup'): void {
    if (!this.#phaseStartedAt) return;

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - this.#phaseStartedAt.getTime();

    const phaseEvidence: PhaseEvidence = {
      phase,
      startedAt: this.#phaseStartedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
      steps: [...this.#currentSteps],
      passed: this.#currentSteps.filter((s) => s.status === 'passed').length,
      failed: this.#currentSteps.filter((s) => s.status === 'failed' || s.status === 'error').length,
      skipped: this.#currentSteps.filter((s) => s.status === 'skipped').length,
    };

    this.#phases.push(phaseEvidence);
    this.#phaseStartedAt = null;
    this.#currentSteps = [];
  }

  /**
   * Step sonucunu kaydeder.
   */
  addStepResult(result: StepResult, bridgeRequest?: StepEvidence['bridgeRequest']): void {
    const stepEvidence: StepEvidence = {
      stepName: result.stepName,
      phase: result.phase,
      index: result.index,
      status: result.status,
      durationMs: result.durationMs,
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.suggestedAction !== undefined ? { suggestedAction: result.suggestedAction } : {}),
      ...(bridgeRequest !== undefined ? { bridgeRequest } : {}),
    };

    this.#currentSteps.push(stepEvidence);
  }

  /**
   * Assertion sonucunu kaydeder.
   */
  addAssertionResult(assertion: AssertionResult, durationMs: number, attempts: number): void {
    const assertionEvidence: AssertionEvidence = {
      stepName: assertion.stepName,
      passed: assertion.passed,
      message: assertion.message,
      ...(assertion.expected !== undefined ? { expected: assertion.expected } : {}),
      ...(assertion.actual !== undefined ? { actual: assertion.actual } : {}),
      durationMs,
      attempts,
    };

    this.#assertions.push(assertionEvidence);
  }

  /**
   * Bridge request/response kaydeder.
   */
  recordBridgeRequest(
    _stepName: string,
    _operation: string,
    _args: Record<string, unknown>,
    _result?: Record<string, unknown>,
    _error?: string,
  ): void {
    // Bridge request'leri step result ile birlikte saklanır
    // Bu metot ileride genisletilebilir
  }

  /**
   * Tüm kanıtları evidence store'a yazar.
   */
  async flush(
    scenarioRunId: string,
    status: 'completed' | 'failed' | 'timed_out',
    startedAt: Date,
    completedAt: Date,
  ): Promise<string[]> {
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Scenario run evidence'ı oluştur
    const scenarioRunEvidence: ScenarioRunEvidence = {
      scenarioRunId,
      scenarioId: this.#options.scenarioId,
      scenarioPath: this.#options.scenarioPath,
      projectId: this.#options.projectId,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
      status,
      phases: [...this.#phases],
      totalSteps: this.#phases.reduce((sum, p) => sum + p.steps.length, 0),
      totalPassed: this.#phases.reduce((sum, p) => sum + p.passed, 0),
      totalFailed: this.#phases.reduce((sum, p) => sum + p.failed, 0),
      totalSkipped: this.#phases.reduce((sum, p) => sum + p.skipped, 0),
      assertions: [...this.#assertions],
    };

    // Evidence store'a yaz
    try {
      const manifest = await this.#store.put({
        runId: scenarioRunId,
        scenarioRunId,
        kind: 'assertion-result',
        producer: {
          component: 'run-supervisor',
          version: this.#options.version,
        },
        content: JSON.stringify(scenarioRunEvidence, null, 2),
        retentionHours: 72, // 3 gun sakla
      });

      this.#evidenceIds.push(manifest.evidenceId);
      this.#log('INFO', 'scenario.evidence_flushed', {
        evidence_id: manifest.evidenceId,
        scenario_run_id: scenarioRunId,
        total_steps: scenarioRunEvidence.totalSteps,
        total_passed: scenarioRunEvidence.totalPassed,
        total_failed: scenarioRunEvidence.totalFailed,
      });
    } catch (err) {
      this.#log('ERROR', 'scenario.evidence_flush_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Her assertion icin ayri evidence yaz
    for (const assertion of this.#assertions) {
      try {
        const manifest = await this.#store.put({
          runId: scenarioRunId,
          scenarioRunId,
          kind: 'assertion-result',
          producer: {
            component: 'run-supervisor',
            version: this.#options.version,
          },
          content: JSON.stringify(assertion, null, 2),
          retentionHours: 72,
        });

        this.#evidenceIds.push(manifest.evidenceId);
      } catch (err) {
        this.#log('ERROR', 'scenario.assertion_evidence_failed', {
          step_name: assertion.stepName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return [...this.#evidenceIds];
  }

  /**
   * Toplanan kanıt sayısını döndürür.
   */
  get evidenceCount(): number {
    return this.#evidenceIds.length;
  }

  /**
   * Tüm phase'leri döndürür.
   */
  get phases(): readonly PhaseEvidence[] {
    return this.#phases;
  }

  /**
   * Tüm assertion'ları döndürür.
   */
  get assertions(): readonly AssertionEvidence[] {
    return this.#assertions;
  }

  #log(_level: string, _event: string, _fields: Record<string, unknown> = {}): void {
    // Logger opsiyonel, simdilik konsola yazdirma yok
  }
}
