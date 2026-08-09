/**
 * Scenario rapor üretici testleri — JSON · Markdown · JUnit XML.
 *
 * Sözleşme (docs/contracts/evidence.md): üç format aynı `report_id`'yi ve
 * aynı provenance alanlarını taşır; kamuya açık raporda mutlak host path
 * bulunmaz (redaction, üretici reddi).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateScenarioReports,
  type ScenarioReportOptions,
} from '../src/scenario-report.js';

const baseOptions: ScenarioReportOptions = {
  runId: 'run_test',
  compatibilityProfile: 'paper-26.2-build-84-v1',
  fixtureId: 'flat-world-v1',
  projectId: 'minimal-paper-plugin',
  sourceSnapshotId: 'src_test',
  buildArtifactId: 'bart_test',
  runtimeImageId: 'rimg_test',
  scenarios: [
    {
      scenarioId: 'world-read-block',
      scenarioPath: 'scenarios/world/read-block.yaml',
      scenarioRunId: 'sr_1',
      status: 'completed',
      passed: 3,
      failed: 0,
      skipped: 0,
      durationMs: 22890,
      evidenceIds: ['ev_1'],
    },
    {
      scenarioId: 'config-region-not-allowed',
      scenarioPath: 'scenarios/configuration/region-not-allowed.yaml',
      scenarioRunId: 'sr_2',
      status: 'failed',
      passed: 0,
      failed: 1,
      skipped: 0,
      durationMs: 22266,
      evidenceIds: [],
    },
    {
      scenarioId: 'config-chunk-not-loaded',
      scenarioPath: 'scenarios/configuration/chunk-not-loaded.yaml',
      scenarioRunId: 'sr_3',
      status: 'timed_out',
      passed: 0,
      failed: 1,
      skipped: 1,
      durationMs: 60000,
      evidenceIds: [],
    },
  ],
};

async function withReportDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'scenario-report-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------ Ortak sözleşme

test('rapor: üç format aynı report_id taşır ve dosyalar üretilir', async () => {
  await withReportDir(async (dir) => {
    const outputs = await generateScenarioReports(baseOptions, dir);

    assert.match(outputs.reportId, /^rep_[0-9a-f]{24}$/);
    assert.equal(outputs.jsonPath, join(dir, `${outputs.reportId}.json`));
    assert.equal(outputs.markdownPath, join(dir, `${outputs.reportId}.md`));
    assert.equal(outputs.junitPath, join(dir, `${outputs.reportId}.xml`));

    const [json, md, xml] = await Promise.all([
      readFile(outputs.jsonPath, 'utf8'),
      readFile(outputs.markdownPath, 'utf8'),
      readFile(outputs.junitPath, 'utf8'),
    ]);
    assert.ok(json.includes(outputs.reportId));
    assert.ok(md.includes(outputs.reportId));
    assert.ok(xml.includes(outputs.reportId));
  });
});

test('rapor: mutlak scenario_path reddedilir', async () => {
  await withReportDir(async (dir) => {
    const options: ScenarioReportOptions = {
      ...baseOptions,
      scenarios: [
        {
          ...baseOptions.scenarios[0]!,
          scenarioPath: 'C:\\Users\\faruk\\scenarios\\read-block.yaml',
        },
      ],
    };

    await assert.rejects(
      generateScenarioReports(options, dir),
      (err: unknown) =>
        err instanceof Error &&
        (err as { code?: string }).code === 'SCENARIO_REPORT_PATH_ABSOLUTE',
    );
  });
});

// ------------------------------------------------------------ JSON

test('rapor: JSON şekli ve özet doğru', async () => {
  await withReportDir(async (dir) => {
    const outputs = await generateScenarioReports(baseOptions, dir);
    const report = JSON.parse(await readFile(outputs.jsonPath, 'utf8')) as {
      schema: string;
      report_id: string;
      run_id: string;
      provenance: Record<string, string | undefined>;
      summary: { total: number; passed: number; failed: number; timedOut: number; durationMs: number };
      scenarios: Array<Record<string, unknown>>;
    };

    assert.equal(report.schema, 'scenario-report-v1');
    assert.equal(report.report_id, outputs.reportId);
    assert.equal(report.run_id, 'run_test');
    assert.equal(report.provenance.compatibility_profile, 'paper-26.2-build-84-v1');
    assert.equal(report.provenance.fixture_id, 'flat-world-v1');
    assert.equal(report.summary.total, 3);
    assert.equal(report.summary.passed, 1);
    assert.equal(report.summary.failed, 1);
    assert.equal(report.summary.timedOut, 1);
    assert.equal(report.summary.durationMs, 22890 + 22266 + 60000);
    assert.equal(report.scenarios.length, 3);
    assert.equal(report.scenarios[1]!['scenario_path'], 'scenarios/configuration/region-not-allowed.yaml');
  });
});

// ------------------------------------------------------------ Markdown

test('rapor: Markdown özet ve scenario tablosu içerir, mutlak yol içermez', async () => {
  await withReportDir(async (dir) => {
    const outputs = await generateScenarioReports(baseOptions, dir);
    const md = await readFile(outputs.markdownPath, 'utf8');

    assert.ok(md.includes('## Özet'));
    assert.ok(md.includes('| 3 | 1 | 1 | 1 |'));
    assert.ok(md.includes('## Scenario'));
    assert.ok(md.includes('scenarios/world/read-block.yaml'));
    assert.ok(md.includes('PASSED'));
    assert.ok(md.includes('FAILED'));
    assert.ok(!md.includes('C:\\') && !md.includes('C:/'), 'markdown mutlak host path içermemeli');
  });
});

// ------------------------------------------------------------ JUnit XML

test('rapor: JUnit XML testcase/failure sayıları ve escape doğru', async () => {
  await withReportDir(async (dir) => {
    const options: ScenarioReportOptions = {
      ...baseOptions,
      scenarios: [
        ...baseOptions.scenarios,
        {
          scenarioId: 'world-read-&write',
          scenarioPath: 'scenarios/world/read-&-write.yaml',
          scenarioRunId: 'sr_4',
          status: 'failed',
          passed: 0,
          failed: 2,
          skipped: 0,
          durationMs: 1000,
          evidenceIds: [],
        },
      ],
    };

    const outputs = await generateScenarioReports(options, dir);
    const xml = await readFile(outputs.junitPath, 'utf8');

    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.match(xml, /<testsuites name="scenario" tests="4" failures="3"/);
    assert.match(xml, /<testsuite name="rep_[0-9a-f]{24}" tests="4" failures="3"/);
    assert.match(xml, /<testcase classname="scenarios\.world\.read-block\.yaml" name="world-read-block"/);
    assert.match(xml, /<failure type="failed" message="1 adım başarısız">/);
    assert.match(xml, /<failure type="timed_out" message="1 adım başarısız">/);
    // XML escape: '&' -> '&amp;', '<' -> '&lt;'
    assert.ok(xml.includes('world-read-&amp;write'), 'özel karakterler XML içinde escape edilmeli');
    assert.ok(xml.includes('read-&amp;-write.yaml'));
    assert.ok(!xml.includes('world-read-&write'), 'escape edilmemiş & kalmamalı');
    assert.ok(!xml.includes('C:\\'), 'xml mutlak host path içermemeli');
  });
});

// ------------------------------------------------------------ Atomic yazım

test('rapor: temp dosya kalıntısı kalmaz (atomic write)', async () => {
  await withReportDir(async (dir) => {
    const outputs = await generateScenarioReports(baseOptions, dir);
    const leftovers = (await import('node:fs/promises')).readdir(dir);
    const names = await leftovers;
    assert.equal(names.filter((n) => n.endsWith('.tmp')).length, 0);
    assert.deepEqual(names.sort(), [
      `${outputs.reportId}.json`,
      `${outputs.reportId}.md`,
      `${outputs.reportId}.xml`,
    ].sort());
  });
});
