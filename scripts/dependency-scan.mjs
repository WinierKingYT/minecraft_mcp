#!/usr/bin/env node
/**
 * dependency-scan.mjs — bağımlılık zafiyet taraması (OSV).
 *
 * SBOM'un (generate-sbom.mjs) ürettiği purl listesini alır, OSV querybatch
 * API'sine sorar ve bulguları severity eşiğine göre raporlar.
 *
 * Çıkış kodları:
 *   0  geçti  — eşiğin üstünde bilinmeyen bulgu yok (allowlist hariç tutulur)
 *   1  kaldı  — eşiğin üstünde ve allowlist'te OLMAYAN bulgu var
 *   2  hata   — OSV API erişilemedi / beklenmedik hata
 *
 * Kullanım: node scripts/dependency-scan.mjs [--min-severity <seviye>] [--allowlist <yol>]
 *   --min-severity  Varsayılan `high`. Alt eşik: critical | high | moderate | low
 *   --allowlist     Varsayılan security/dependency-scan.allowlist.yaml
 *   --quiet         Bulgu detaylarını bastırır
 *
 * Severity kaynağı: OSV `database_specific.severity` (GitHub seviyesi),
 * yoksa CVSS v3 base score'dan türetilir.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { parsePnpmLockfile, parseGradleLockfile } from './lib/lockfiles.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const OSV_API = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN = 'https://api.osv.dev/v1/vulns';
const BATCH_SIZE = 500;
const HTTP_TIMEOUT_MS = 60_000;

const SEVERITY_RANK = { critical: 4, high: 3, moderate: 2, low: 1 };
const RANK_LABEL = ['unknown', 'low', 'moderate', 'high', 'critical'];

// ─── Argüman ayrıştırma ────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { minSeverity: 'high', allowlist: join(ROOT, 'security', 'dependency-scan.allowlist.yaml'), quiet: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--min-severity':
        opts.minSeverity = (argv[++i] ?? '').toLowerCase();
        break;
      case '--allowlist':
        opts.allowlist = argv[++i];
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new Error(`Bilinmeyen argüman: ${argv[i]}`);
    }
  }
  return opts;
}

// ─── OSV HTTP yardımcıları ─────────────────────────────────────────────

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

async function queryBatch(purls) {
  const body = JSON.stringify({ queries: purls.map((purl) => ({ package: { purl } })) });
  const resp = await fetchWithTimeout(OSV_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  const data = await resp.json();
  if (!Array.isArray(data.results) || data.results.length !== purls.length) {
    throw new Error('OSV querybatch: sonuç sayısı sorgu sayısıyla eşleşmiyor');
  }
  return data.results.map((r, i) => ({ purl: purls[i], vulns: r.vulns ?? [] }));
}

async function fetchVuln(id) {
  const resp = await fetchWithTimeout(`${OSV_VULN}/${encodeURIComponent(id)}`);
  return resp.json();
}

function severityOf(vuln) {
  const db = vuln.database_specific?.severity;
  if (db && typeof db === 'string') {
    const rank = SEVERITY_RANK[db.toLowerCase()];
    if (rank !== undefined) return { rank, label: RANK_LABEL[rank] };
  }
  for (const sev of vuln.severity ?? []) {
    if (sev.type === 'CVSS_V3' && typeof sev.score === 'string') {
      const rank = rankFromCvss(sev.score);
      if (rank !== undefined) return { rank, label: RANK_LABEL[rank] };
    }
  }
  return { rank: 0, label: 'unknown' };
}

function rankFromCvss(vector) {
  // CVSS v3 base score -> severity. Parsing minimal: AV/AC/PR/UI/S/C/I/A.
  const m = {};
  for (const part of vector.split('/')) {
    const eq = part.indexOf(':');
    if (eq === -1) continue;
    m[part.slice(0, eq)] = part.slice(eq + 1);
  }
  const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV];
  const AC = { L: 0.77, H: 0.44 }[m.AC];
  const PR = m.S === 'C' ? { N: 0.85, L: 0.68, H: 0.5 }[m.PR] : { N: 0.85, L: 0.62, H: 0.27 }[m.PR];
  const UI = { N: 0.85, R: 0.62 }[m.UI];
  const CI = { N: 0, L: 0.22, H: 0.56 }[m.C];
  const II = { N: 0, L: 0.22, H: 0.56 }[m.I];
  const AI = { N: 0, L: 0.22, H: 0.56 }[m.A];
  if ([AV, AC, PR, UI, CI, II, AI].some((x) => x === undefined)) return undefined;

  const iss = 1 - (1 - CI) * (1 - II) * (1 - AI);
  const impact = m.S === 'C' ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploitability = 8.22 * AV * AC * PR * UI;
  const score = Math.min(impact + exploitability, 10);
  if (score >= 9) return 4;
  if (score >= 7) return 3;
  if (score >= 4) return 2;
  return 1;
}

// ─── Allowlist ─────────────────────────────────────────────────────────

function loadAllowlist(path) {
  if (!existsSync(path)) return [];
  const doc = parse(readFileSync(path, 'utf8'));
  return (doc?.entries ?? []).map((e) => ({
    purl: String(e.purl ?? ''),
    vulnId: String(e.vuln_id ?? ''),
    reason: String(e.reason ?? ''),
  }));
}

// ─── Ana akış ──────────────────────────────────────────────────────────

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`✗ ${err.message}\n`);
    process.exit(2);
  }
  if (opts.help) {
    process.stdout.write(`Kullanım: node scripts/dependency-scan.mjs [--min-severity <seviye>] [--allowlist <yol>] [--quiet]
`);
    process.exit(0);
  }

  if (SEVERITY_RANK[opts.minSeverity] === undefined) {
    process.stderr.write(`✗ Bilinmeyen --min-severity: ${opts.minSeverity} (critical|high|moderate|low)\n`);
    process.exit(2);
  }
  const minRank = SEVERITY_RANK[opts.minSeverity];

  const pnpmPath = join(ROOT, 'pnpm-lock.yaml');
  const gradlePath = join(ROOT, 'bridge', 'paper', 'gradle.lockfile');

  const nodeComponents = parsePnpmLockfile(pnpmPath);
  const gradleComponents = parseGradleLockfile(gradlePath);
  const purls = [...new Set([...nodeComponents, ...gradleComponents].map((c) => c.purl))];

  process.stderr.write(`  ✓ lockfile'lar okundu: ${purls.length} purl (npm ${nodeComponents.length}, maven ${gradleComponents.length})\n`);

  // OSV querybatch — 500'lük gruplar
  let results = [];
  for (let i = 0; i < purls.length; i += BATCH_SIZE) {
    const chunk = purls.slice(i, i + BATCH_SIZE);
    results.push(...(await queryBatch(chunk)));
  }

  // Bulguları topla
  const findings = [];
  const vulnCache = new Map();
  for (const r of results) {
    for (const v of r.vulns) {
      let detail = vulnCache.get(v.id);
      if (!detail) {
        detail = await fetchVuln(v.id);
        vulnCache.set(v.id, detail);
      }
      findings.push({
        purl: r.purl,
        vulnId: v.id,
        severity: severityOf(detail),
        summary: detail.summary ?? '',
        modified: detail.modified ?? '',
      });
    }
  }

  const allowlist = loadAllowlist(opts.allowlist);
  const allowlistKeys = new Set(allowlist.map((e) => `${e.purl}::${e.vulnId}`));

  // Stale allowlist girdisi: bileşen düzeltilmiş ama girdi duruyor.
  const stale = allowlist.filter((e) => !findings.some((f) => `${f.purl}::${f.vulnId}` === `${e.purl}::${e.vulnId}`));
  if (stale.length) {
    process.stderr.write(`  ! ${stale.length} stale allowlist girdisi (bileşen düzeltilmiş olabilir):\n`);
    for (const s of stale) process.stderr.write(`    - ${s.purl} ${s.vulnId}\n`);
  }

  // Eşiğin üstünde ve allowlist'te olmayanlar -> gate kırılır
  const blocking = findings.filter((f) => f.severity.rank >= minRank && !allowlistKeys.has(`${f.purl}::${f.vulnId}`));

  process.stdout.write(`\ndependency-scan\n`);
  process.stdout.write(`  taranan purl  : ${purls.length}\n`);
  process.stdout.write(`  bulgu         : ${findings.length}\n`);
  process.stdout.write(`  min severity  : ${opts.minSeverity}\n`);
  process.stdout.write(`  allowlist     : ${allowlist.length} girdi (${stale.length} stale)\n\n`);

  if (findings.length === 0) {
    process.stdout.write(`  ✓ Bilinen zafiyet bulunmadı.\n`);
    process.exit(0);
  }

  const bySeverity = (label) => findings.filter((f) => f.severity.label === label);
  process.stdout.write(`  Severity dağılımı:\n`);
  for (const label of ['critical', 'high', 'moderate', 'low', 'unknown']) {
    const n = bySeverity(label).length;
    if (n > 0) process.stdout.write(`    ${label.padEnd(10)} ${n}\n`);
  }
  process.stdout.write('\n');

  if (!opts.quiet) {
    process.stdout.write(`  Bulgular:\n`);
    for (const f of [...findings].sort((a, b) => b.severity.rank - a.severity.rank)) {
      const allowed = allowlistKeys.has(`${f.purl}::${f.vulnId}`) ? ' [allowlist]' : '';
      process.stdout.write(`    ${f.severity.label.padEnd(10)} ${f.purl}  ${f.vulnId}${allowed}\n`);
      if (f.summary) process.stdout.write(`      ${f.summary}\n`);
    }
    process.stdout.write('\n');
  }

  if (blocking.length) {
    process.stdout.write(`  ✗ ${blocking.length} bulgu eşiğin üstünde ve allowlist'te değil — gate KALDI.\n`);
    for (const b of blocking) process.stdout.write(`    - ${b.severity.label.toUpperCase()} ${b.purl} ${b.vulnId}\n`);
    process.exit(1);
  }

  process.stdout.write(`  ✓ Eşiğin üstündeki tüm bulgular allowlist'te — gate GEÇTİ.\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`✗ dependency-scan hatası: ${err.message}\n`);
  process.exit(2);
});
