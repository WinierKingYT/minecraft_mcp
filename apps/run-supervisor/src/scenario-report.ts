/**
 * Scenario rapor üretici — JSON · Markdown · JUnit XML.
 *
 * Sözleşme (docs/contracts/evidence.md): üç format aynı `report_id`'yi ve
 * aynı provenance alanlarını taşır; `result` ve `cleanup` ayrı alanlardır
 * (KPI-12); kamuya açık raporda mutlak host path bulunmaz — entry'ler
 * `scenario_path` alanını göreli yol olarak taşır, mutlak yol verilirse
 * üretici reddeder.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export type ScenarioReportStatus = 'completed' | 'failed' | 'timed_out';

export interface ScenarioReportEntry {
  readonly scenarioId: string;
  /** Public raporda görünecek göreli yol (repo köküne göre). */
  readonly scenarioPath: string;
  readonly scenarioRunId: string;
  readonly status: ScenarioReportStatus;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly durationMs: number;
  readonly evidenceIds: readonly string[];
}

export interface ScenarioReportOptions {
  readonly runId: string;
  readonly compatibilityProfile: string;
  readonly fixtureId: string;
  readonly projectId?: string;
  readonly sourceSnapshotId?: string;
  readonly buildArtifactId?: string;
  readonly runtimeImageId?: string;
  readonly generatedAt?: string;
  readonly scenarios: readonly ScenarioReportEntry[];
}

export interface ScenarioReportOutputs {
  readonly reportId: string;
  readonly jsonPath: string;
  readonly markdownPath: string;
  readonly junitPath: string;
}

interface ReportCore {
  readonly reportId: string;
  readonly runId: string;
  readonly generatedAt: string;
  readonly provenance: Record<string, string | undefined>;
  readonly summary: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly timedOut: number;
    readonly durationMs: number;
  };
  readonly scenarios: readonly ScenarioReportEntry[];
}

function newReportId(): string {
  return `rep_${randomBytes(12).toString('hex')}`;
}

function buildCore(options: ScenarioReportOptions): ReportCore {
  // Kamuya açık rapor mutlak host path taşıyamaz (evidence.md: "No absolute
  // host path in public report"). Göreli olmayan yol sözleşme ihlalidir.
  // Ayraçlar rapor boyunca Unix formuna normalize edilir (JUnit classname ve
  // Markdown tablosu tek formatta kalır).
  for (const entry of options.scenarios) {
    const normalized = entry.scenarioPath.replace(/\\/g, '/');
    if (isAbsolute(normalized)) {
      throw Object.assign(
        new Error(`scenario_path mutlak olamaz: ${entry.scenarioPath}`),
        { code: 'SCENARIO_REPORT_PATH_ABSOLUTE' },
      );
    }
  }

  const summary = {
    total: options.scenarios.length,
    passed: options.scenarios.filter((s) => s.status === 'completed').length,
    failed: options.scenarios.filter((s) => s.status === 'failed').length,
    timedOut: options.scenarios.filter((s) => s.status === 'timed_out').length,
    durationMs: options.scenarios.reduce((acc, s) => acc + s.durationMs, 0),
  };

  return {
    reportId: newReportId(),
    runId: options.runId,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    provenance: {
      source_snapshot_id: options.sourceSnapshotId,
      build_artifact_id: options.buildArtifactId,
      runtime_image_id: options.runtimeImageId,
      compatibility_profile: options.compatibilityProfile,
      fixture_id: options.fixtureId,
      project_id: options.projectId,
    },
    summary,
    scenarios: options.scenarios.map((s) => ({
      ...s,
      scenarioPath: s.scenarioPath.replace(/\\/g, '/'),
    })),
  };
}

/**
 * Mutlak yol içeren dizeleri rapordan ayıklar (çift savunma).
 * Windows sürücü yolları (`C:\`, `C:/`) ve UNC (`\\`) kapsanır.
 */
function redactAbsolutePaths(text: string): string {
  return text.replace(/[A-Za-z]:[\\/][^\s"'<>|]*/g, '<path>').replace(/\\\\[^\s"'<>|]*/g, '<path>');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toJsonReport(core: ReportCore): string {
  const report = {
    schema: 'scenario-report-v1',
    report_id: core.reportId,
    run_id: core.runId,
    generated_at: core.generatedAt,
    provenance: core.provenance,
    summary: core.summary,
    scenarios: core.scenarios.map((s) => ({
      scenario_id: s.scenarioId,
      scenario_path: s.scenarioPath,
      scenario_run_id: s.scenarioRunId,
      status: s.status,
      passed: s.passed,
      failed: s.failed,
      skipped: s.skipped,
      duration_ms: s.durationMs,
      evidence_ids: s.evidenceIds,
    })),
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

function toMarkdownReport(core: ReportCore): string {
  const statusLabel: Record<ScenarioReportStatus, string> = {
    completed: 'PASSED',
    failed: 'FAILED',
    timed_out: 'TIMED_OUT',
  };

  const lines: string[] = [];
  lines.push(`# Scenario raporu — ${core.reportId}`);
  lines.push('');
  lines.push(`- **report_id:** \`${core.reportId}\``);
  lines.push(`- **run_id:** \`${core.runId}\``);
  lines.push(`- **üretim zamanı:** ${core.generatedAt}`);
  lines.push(`- **compatibility_profile:** ${core.provenance.compatibility_profile}`);
  lines.push(`- **fixture_id:** ${core.provenance.fixture_id}`);
  if (core.provenance.project_id) lines.push(`- **project_id:** ${core.provenance.project_id}`);
  lines.push('');
  lines.push('## Özet');
  lines.push('');
  lines.push(`| Toplam | PASSED | FAILED | TIMED_OUT | Toplam süre |`);
  lines.push(`|---|---|---|---|---|`);
  lines.push(
    `| ${core.summary.total} | ${core.summary.passed} | ${core.summary.failed} | ${core.summary.timedOut} | ${core.summary.durationMs} ms |`,
  );
  lines.push('');
  lines.push("## Scenario'lar");
  lines.push('');
  lines.push(`| Scenario | Durum | Adım | Geçen | Süre |`);
  lines.push(`|---|---|---|---|---|`);
  for (const s of core.scenarios) {
    lines.push(
      `| \`${s.scenarioId}\` (${s.scenarioPath}) | ${statusLabel[s.status]} | ${s.passed}/${s.passed + s.failed + s.skipped} | ${s.evidenceIds.length} | ${s.durationMs} ms |`,
    );
  }
  lines.push('');
  return redactAbsolutePaths(`${lines.join('\n')}\n`);
}

function toJunitReport(core: ReportCore): string {
  const totalMs = core.summary.durationMs;
  const time = (totalMs / 1000).toFixed(3);
  const failures = core.summary.failed + core.summary.timedOut;

  const testcases: string[] = [];
  for (const s of core.scenarios) {
    const name = escapeXml(s.scenarioId);
    const classname = escapeXml(s.scenarioPath.replace(/\//g, '.'));
    const t = (s.durationMs / 1000).toFixed(3);
    if (s.status === 'completed') {
      testcases.push(
        `    <testcase classname="${classname}" name="${name}" time="${t}">\n` +
          `      <system-out>${escapeXml(`${s.passed}/${s.passed + s.failed + s.skipped} adım geçti, ${s.evidenceIds.length} kanıt`)}</system-out>\n` +
          `    </testcase>`,
      );
    } else {
      const kind = s.status === 'timed_out' ? 'timed_out' : 'failed';
      testcases.push(
        `    <testcase classname="${classname}" name="${name}" time="${t}">\n` +
          `      <failure type="${kind}" message="${escapeXml(`${s.failed} adım başarısız`)}">${escapeXml(`${s.failed}/${s.passed + s.failed + s.skipped} adım başarısız, ${s.evidenceIds.length} kanıt`)}</failure>\n` +
          `    </testcase>`,
      );
    }
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites name="scenario" tests="${core.summary.total}" failures="${failures}" time="${time}">\n` +
    `  <testsuite name="${escapeXml(core.reportId)}" tests="${core.summary.total}" failures="${failures}" time="${time}">\n` +
    `${testcases.join('\n')}\n` +
    `  </testsuite>\n` +
    `</testsuites>\n`;

  return redactAbsolutePaths(xml);
}

/**
 * Üç rapor formatını tek `report_id` ile üretir.
 *
 * Dosyalar atomik yazılır (evidence.md storage kuralı: temp-write + rename).
 * Dosya adları report_id'yi taşır: `<reportId>.json|.md|.xml`.
 */
export async function generateScenarioReports(
  options: ScenarioReportOptions,
  reportDir: string,
): Promise<ScenarioReportOutputs> {
  const core = buildCore(options);
  await mkdir(reportDir, { recursive: true });

  const files = [
    { key: 'jsonPath' as const, ext: 'json', content: toJsonReport(core) },
    { key: 'markdownPath' as const, ext: 'md', content: toMarkdownReport(core) },
    { key: 'junitPath' as const, ext: 'xml', content: toJunitReport(core) },
  ] as const;

  const outputs: Record<'jsonPath' | 'markdownPath' | 'junitPath', string> = {
    jsonPath: '',
    markdownPath: '',
    junitPath: '',
  };

  for (const file of files) {
    const finalPath = join(reportDir, `${core.reportId}.${file.ext}`);
    const tempPath = join(reportDir, `${core.reportId}.${file.ext}.tmp`);
    await writeFile(tempPath, file.content, 'utf8');
    await rename(tempPath, finalPath);
    outputs[file.key] = finalPath;
  }

  return { reportId: core.reportId, ...outputs };
}
