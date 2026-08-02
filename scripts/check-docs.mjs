#!/usr/bin/env node
// DOC-GATE-01, 02, 03 (link checker), 05, 06.
//
// Bu script'in en kritik parçası güvenlik dürüstlüğü taramasıdır (DOC-GATE-06):
// "trusted-local" ile "sandbox" kelimelerinin aynı paragrafta geçmesi, ancak
// paragraf açık bir olumsuzlama içeriyorsa kabul edilir. Bu, iyi niyetli bir
// dokümantasyon düzenlemesinin KPI-11'i sessizce ihlal etmesini engeller.
//
// Dosya allowlist'i BİLİNÇLİ OLARAK kullanılmaz: allowlist büyüdükçe kapı
// anlamsızlaşır. Bunun yerine ifadenin kendisi denetlenir.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { ROOT, PATHS, readYaml, fail, ok } from './lib/registry.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.gradle', 'coverage', 'runtimes', 'evidence']);
const errors = [];
const warnings = [];

/**
 * Açık olumsuzlama ifadeleri. Liste bilinçli olarak DAR tutulur: genişledikçe
 * kapı anlamsızlaşır. Meşru fakat listede olmayan bir ifade kullanan paragraf
 * için aşağıdaki muafiyet işareti kullanılır.
 */
const NEGATION = [
  'değildir',
  'değil',
  'adlandırılamaz',
  'adlandırılmaz',
  'sunulmamalı',
  'sunulmaz',
  'sağlamaz',
  'kullanılamaz',
  'is not',
  'must not',
  'never',
  'yasak',
];

/**
 * KPI-11 muafiyet işareti.
 *
 * Kuralın KENDİSİNİ tartışan metinler (ADR-0007, karşılaştırma tabloları,
 * reddedilen alternatifler) kaçınılmaz olarak iki kelimeyi yan yana getirir.
 * Bunlar için fuzzy kelime listesini genişletmek yerine, insan tarafından
 * yazılmış ve greplenebilir bir muafiyet istenir:
 *
 *   <!-- kpi-11-exempt: neden -->
 *
 * Muafiyet sayısı her koşuda raporlanır; sessizce çoğalamaz.
 */
const EXEMPT_MARKER = /<!--\s*kpi-11-exempt:/i;

const PLACEHOLDERS = [/\bTODO\b/, /\bTBD\b/, /\bFIXME\b/, /\bX\.Y\.Z\b/, /<version>/i, /\?\?\?/];

/** Fenced ve inline kod içeriğini kaldırır (placeholder taraması için). */
function stripCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function markdownFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) markdownFiles(full, out);
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

const files = markdownFiles(ROOT);

// ---------------------------------------------- DOC-GATE-06: güvenlik dürüstlüğü
let exemptions = 0;

for (const file of files) {
  const rel = relative(ROOT, file);
  const content = readFileSync(file, 'utf8');
  const paragraphs = content.split(/\n\s*\n/);

  for (const [i, para] of paragraphs.entries()) {
    const lower = para.toLowerCase();
    if (!/sandbox/.test(lower)) continue;
    if (!/trusted[-\s]?local/.test(lower)) continue;

    if (NEGATION.some((n) => lower.includes(n))) continue;

    // Muafiyet, paragrafın kendisinde veya hemen öncesinde olabilir.
    const previous = paragraphs[i - 1] ?? '';
    if (EXEMPT_MARKER.test(para) || EXEMPT_MARKER.test(previous)) {
      exemptions += 1;
      continue;
    }

    errors.push(
      `DOC-GATE-06 ${rel} (paragraf ${i + 1}): "trusted-local" ve "sandbox" aynı paragrafta, ` +
        'fakat açık bir olumsuzlama yok. Trusted Local sandbox olarak adlandırılamaz (KPI-11). ' +
        'Kuralın kendisini tartışıyorsa <!-- kpi-11-exempt: neden --> ekleyin.',
    );
  }
}

// Zorunlu limitation ifadesi mevcut mu?
{
  const guarantees = join(PATHS.docs, 'security', 'guarantees.md');
  if (!existsSync(guarantees)) {
    errors.push('DOC-GATE-06: docs/security/guarantees.md bulunamadı.');
  } else {
    const text = readFileSync(guarantees, 'utf8').toLowerCase();
    const hasSameJvm = /aynı paper jvm'i içinde/.test(text) && /güvenlik sınırı değildir/.test(text);
    if (!hasSameJvm) {
      errors.push(
        'DOC-GATE-06: guarantees.md içinde same-JVM limitation cümlesi bulunamadı. ' +
          'Bu cümlenin varlığı zorunludur (ADR-0007).',
      );
    }
  }
}

// ------------------------------------------------------ DOC-GATE-02: belirsizlik
for (const file of files) {
  const rel = relative(ROOT, file);
  const isSpike = rel.includes(join('delivery', 'spikes'));
  const content = readFileSync(file, 'utf8');

  if (isSpike) {
    // Spike'lar açık kararlar taşır; placeholder yerine gate alanları zorunludur.
    if (!/\*\*Durum:\*\*/.test(content) || !/\*\*Blokladığı:\*\*/.test(content)) {
      if (!rel.endsWith(join('spikes', 'README.md'))) {
        errors.push(`DOC-GATE-02 ${rel}: spike dosyası "Durum" ve "Blokladığı" alanlarını taşımalıdır.`);
      }
    }
    continue;
  }

  // Kod blokları ve inline kod hariç tutulur: kapının KENDİSİNİ belgeleyen
  // metinler bu tokenları kaçınılmaz olarak örnek gösterir.
  for (const [idx, line] of stripCode(content).split('\n').entries()) {
    for (const p of PLACEHOLDERS) {
      if (p.test(line)) {
        errors.push(`DOC-GATE-02 ${rel}:${idx + 1}: karar/sürüm placeholder'ı: ${line.trim().slice(0, 80)}`);
      }
    }
  }
}

// Hareketli sürüm ifadesi — yalnızca uyumluluk profilindeki sürüm alanlarında.
{
  const MOVING = /^(latest|current|stable)$/i;
  const VERSION_FIELDS = ['version', 'build', 'api_coordinate', 'api_version', 'wrapper_version', 'protocol_version', 'runtime_major', 'toolchain_major'];

  for (const f of readdirSync(PATHS.compatibility).filter((x) => x.endsWith('.yaml'))) {
    const profile = readYaml(join(PATHS.compatibility, f));
    const walk = (node, path) => {
      if (node === null || typeof node !== 'object') {
        const key = path[path.length - 1];
        if (VERSION_FIELDS.includes(key) && typeof node === 'string' && MOVING.test(node.trim())) {
          errors.push(`DOC-GATE-02 compatibility/${f}: ${path.join('.')} hareketli sürüm ifadesi taşıyor ("${node}").`);
        }
        return;
      }
      for (const [k, v] of Object.entries(node)) walk(v, [...path, k]);
    };
    walk(profile, []);
  }
}

// ---------------------------------------------------- DOC-GATE-01: boyut ve tekrar
{
  const masterPlan = join(PATHS.docs, 'MASTER-PLAN.md');
  const lines = readFileSync(masterPlan, 'utf8').split('\n').length;

  // Üst sınır sert bir kapıdır: MASTER-PLAN büyüdüyse bölünmesi gerekir.
  if (lines > 1200) {
    errors.push(`DOC-GATE-01: MASTER-PLAN.md ${lines} satır (üst sınır 1200). Bölümleri konu dosyalarına taşıyın.`);
  }
  // Alt sınır bilgilendirmedir: hedeften kısa olmak bir kusur değil, başarılı
  // bölünmenin sonucu olabilir. Sessizce geçmemesi için uyarı üretilir.
  if (lines < 600) {
    warnings.push(`DOC-GATE-01: MASTER-PLAN.md ${lines} satır (hedef aralık 600-1200). Eksik karar var mı kontrol edin.`);
  }
}

// ------------------------------------------------ DOC-GATE-05: izlenebilirlik
{
  const file = join(PATHS.docs, 'traceability.md');
  const content = readFileSync(file, 'utf8');
  const rows = content
    .split('\n')
    .filter((l) => l.startsWith('| REQ-'));

  if (rows.length === 0) errors.push('DOC-GATE-05: traceability.md içinde REQ satırı yok.');

  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 8) {
      errors.push(`DOC-GATE-05 traceability.md: 8 sütun bekleniyor, ${cells.length} bulundu — ${cells[0]}`);
      continue;
    }
    cells.forEach((cell, i) => {
      if (cell === '' || cell === '—' || cell === '-') {
        errors.push(`DOC-GATE-05 traceability.md: ${cells[0]} satırında ${i + 1}. sütun boş.`);
      }
    });
  }
}

// ------------------------------------------------- DOC-GATE-03: link checker
for (const file of files) {
  const rel = relative(ROOT, file);
  const content = readFileSync(file, 'utf8');

  for (const m of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = m[1].trim();
    if (/^(https?:|mailto:|#)/.test(target)) continue;

    const [pathPart] = target.split('#');
    if (!pathPart) continue;

    const resolved = resolve(dirname(file), decodeURIComponent(pathPart));
    if (!existsSync(resolved)) {
      const line = content.slice(0, m.index).split('\n').length;
      errors.push(`DOC-GATE-03 ${rel}:${line}: kırık link -> ${target}`);
    }
  }
}

for (const w of warnings) process.stderr.write(`  ! ${w}\n`);
if (exemptions > 0) {
  process.stderr.write(`  i ${exemptions} KPI-11 muafiyeti kullanıldı (kuralın kendisini tartışan metinler).\n`);
}
if (errors.length) fail(errors);
ok(`${files.length} markdown dosyası denetlendi (DOC-GATE-01/02/03/05/06).`);
