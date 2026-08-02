import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceProfiler } from '../src/performance-profiler.js';

describe('PerformanceProfiler', () => {
  let profiler: PerformanceProfiler;

  afterEach(() => {
    profiler?.destroy();
  });

  test('creates profiler with default options', () => {
    profiler = new PerformanceProfiler();
    const report = profiler.generateReport();
    assert.equal(report.totalSamples, 0);
    assert.equal(report.stats.length, 0);
  });

  test('start creates a sample', () => {
    profiler = new PerformanceProfiler();
    const sample = profiler.start('build', 'build');
    assert.ok(sample.sampleId.startsWith('prof_'));
    assert.equal(sample.operation, 'build');
    assert.equal(sample.category, 'build');
    assert.equal(sample.endMs, null);
    assert.equal(sample.durationMs, null);
    assert.equal(sample.success, null);
  });

  test('end completes a sample', () => {
    profiler = new PerformanceProfiler();
    const sample = profiler.start('build', 'build');
    profiler.end(sample.sampleId, true, { output: 'success.jar' });
    assert.ok(sample.endMs !== null);
    assert.ok(sample.durationMs !== null);
    assert.ok(sample.durationMs! >= 0);
    assert.equal(sample.success, true);
    assert.equal(sample.metadata['output'], 'success.jar');
  });

  test('end with failure', () => {
    profiler = new PerformanceProfiler();
    const sample = profiler.start('build', 'build');
    profiler.end(sample.sampleId, false, { error: 'compile failed' });
    assert.equal(sample.success, false);
    assert.equal(sample.metadata['error'], 'compile failed');
  });

  test('end throws for non-existent sample', () => {
    profiler = new PerformanceProfiler();
    assert.throws(() => profiler.end('non-existent'), /Sample not found/);
  });

  test('measure wraps synchronous function', () => {
    profiler = new PerformanceProfiler();
    const result = profiler.measure('add', 'custom', () => 1 + 2);
    assert.equal(result, 3);
    const samples = profiler.getSamples();
    assert.equal(samples.length, 1);
    assert.equal(samples[0]!.success, true);
  });

  test('measure wraps async function', async () => {
    profiler = new PerformanceProfiler();
    const result = await profiler.measure('async-op', 'custom', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'done';
    });
    assert.equal(result, 'done');
    const samples = profiler.getSamples();
    assert.equal(samples.length, 1);
    assert.equal(samples[0]!.success, true);
    assert.ok((samples[0]!.durationMs ?? 0) >= 10);
  });

  test('measure catches sync errors', () => {
    profiler = new PerformanceProfiler();
    assert.throws(
      () => profiler.measure('fail', 'custom', () => { throw new Error('boom'); }),
      /boom/,
    );
    const samples = profiler.getSamples();
    assert.equal(samples.length, 1);
    assert.equal(samples[0]!.success, false);
  });

  test('measure catches async errors', async () => {
    profiler = new PerformanceProfiler();
    await assert.rejects(
      () => profiler.measure('async-fail', 'custom', async () => { throw new Error('async boom'); }),
      /async boom/,
    );
    const samples = profiler.getSamples();
    assert.equal(samples.length, 1);
    assert.equal(samples[0]!.success, false);
  });

  test('getStats returns correct statistics', () => {
    profiler = new PerformanceProfiler();
    for (let i = 0; i < 10; i++) {
      const sample = profiler.start('build', 'build');
      profiler.end(sample.sampleId, true, { duration: i * 10 });
    }
    const stats = profiler.getStats('build', 'build');
    assert.equal(stats.length, 1);
    assert.equal(stats[0]!.count, 10);
    assert.equal(stats[0]!.successRate, 1.0);
  });

  test('getStats filters by operation', () => {
    profiler = new PerformanceProfiler();
    const s1 = profiler.start('build', 'build');
    profiler.end(s1.sampleId, true);
    const s2 = profiler.start('test', 'scenario');
    profiler.end(s2.sampleId, true);
    const stats = profiler.getStats('build');
    assert.equal(stats.length, 1);
    assert.equal(stats[0]!.operation, 'build');
  });

  test('getStats filters by category', () => {
    profiler = new PerformanceProfiler();
    const s1 = profiler.start('build', 'build');
    profiler.end(s1.sampleId, true);
    const s2 = profiler.start('test', 'scenario');
    profiler.end(s2.sampleId, true);
    const stats = profiler.getStats(undefined, 'build');
    assert.equal(stats.length, 1);
    assert.equal(stats[0]!.category, 'build');
  });

  test('generateReport returns complete report', () => {
    profiler = new PerformanceProfiler();
    const s1 = profiler.start('build', 'build');
    profiler.end(s1.sampleId, true);
    const report = profiler.generateReport();
    assert.equal(report.totalSamples, 1);
    assert.ok(report.operations.includes('build'));
    assert.ok(report.categories.includes('build'));
    assert.ok(report.generatedAt);
  });

  test('clear removes all samples', () => {
    profiler = new PerformanceProfiler();
    profiler.start('build', 'build');
    profiler.clear();
    assert.equal(profiler.getSamples().length, 0);
  });

  test('respects maxSamples limit', () => {
    profiler = new PerformanceProfiler({ maxSamples: 5 });
    for (let i = 0; i < 10; i++) {
      const sample = profiler.start('build', 'build');
      profiler.end(sample.sampleId, true);
    }
    assert.equal(profiler.getSamples().length, 5);
  });

  test('emits sample event on end', () => {
    profiler = new PerformanceProfiler();
    let emitted = false;
    profiler.on('sample', () => { emitted = true; });
    const sample = profiler.start('build', 'build');
    profiler.end(sample.sampleId, true);
    assert.ok(emitted);
  });
});
