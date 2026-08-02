/**
 * Derleyici ve test teşhislerinin yapılandırılması.
 *
 * JTBD-01: "hata varsa dosya, satır, sembol ve önerilen düzeltmeyle görmek
 * istiyorum." Ham log dökümü teşhis sayılmaz (KPI-08).
 *
 * Host yolları rapora sızmamalıdır: her yol proje köküne göre göreli hâle
 * getirilir; kök dışındaki yollar maskelenir.
 */

import { relative, isAbsolute, sep } from 'node:path';

export type DiagnosticSeverity = 'error' | 'warning' | 'note';

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  /** Proje köküne göre yol; çözülemezse null. */
  readonly path: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly message: string;
  /** Derleyicinin bildirdiği sembol veya kod (varsa). */
  readonly symbol: string | null;
}

export interface DiagnosticsSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly failedTasks: readonly string[];
}

/** `/path/File.java:12: error: cannot find symbol` */
const JAVAC_PATTERN = /^(.*?\.(?:java|kt)):(\d+)(?::(\d+))?:\s*(error|warning|note):\s*(.*)$/;

/** `e: file:///C:/x/App.kt:12:5 Unresolved reference: foo` (Kotlin) */
const KOTLIN_PATTERN = /^([ew]):\s*file:\/\/\/?(.*?):(\d+):(\d+)\s+(.*)$/;

/** `> Task :compileJava FAILED` */
const FAILED_TASK_PATTERN = /^>\s*Task\s+(\S+)\s+FAILED\s*$/;

/** `symbol:   variable foo` — javac'ın ayrı satırda verdiği sembol bilgisi. */
const SYMBOL_PATTERN = /^\s*symbol:\s*(.*)$/;

function normalizePath(raw: string, projectRoot: string): string | null {
  const cleaned = raw.trim().replace(/^file:\/\/\/?/, '');
  if (cleaned === '') return null;

  if (!isAbsolute(cleaned)) {
    return cleaned.split(sep).join('/');
  }

  const rel = relative(projectRoot, cleaned);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    // Kök dışındaki yol raporda görünmez: host dizin yapısı sızdırılmaz.
    return null;
  }
  return rel.split(sep).join('/');
}

/**
 * Gradle/javac/kotlinc çıktısını yapılandırılmış teşhislere çevirir.
 *
 * Ayrıştırılamayan satırlar sessizce atılır; amaç tam bir derleyici
 * gramerini uygulamak değil, ajanın harekete geçebileceği kalemleri
 * çıkarmaktır. Ham log ayrıca evidence olarak saklanır.
 */
export function parseDiagnostics(output: string, projectRoot: string): DiagnosticsSummary {
  const diagnostics: Diagnostic[] = [];
  const failedTasks: string[] = [];
  const lines = output.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const failed = FAILED_TASK_PATTERN.exec(line);
    if (failed?.[1]) {
      failedTasks.push(failed[1]);
      continue;
    }

    const javac = JAVAC_PATTERN.exec(line);
    if (javac) {
      // javac sembolü sonraki satırlarda verir.
      let symbol: string | null = null;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const found = SYMBOL_PATTERN.exec(lines[j]!);
        if (found?.[1]) {
          symbol = found[1].trim();
          break;
        }
      }

      diagnostics.push({
        severity: javac[4] as DiagnosticSeverity,
        path: normalizePath(javac[1]!, projectRoot),
        line: Number.parseInt(javac[2]!, 10),
        column: javac[3] ? Number.parseInt(javac[3], 10) : null,
        message: javac[5]!.trim(),
        symbol,
      });
      continue;
    }

    const kotlin = KOTLIN_PATTERN.exec(line);
    if (kotlin) {
      diagnostics.push({
        severity: kotlin[1] === 'e' ? 'error' : 'warning',
        path: normalizePath(kotlin[2]!, projectRoot),
        line: Number.parseInt(kotlin[3]!, 10),
        column: Number.parseInt(kotlin[4]!, 10),
        message: kotlin[5]!.trim(),
        symbol: null,
      });
    }
  }

  return {
    errors: diagnostics.filter((d) => d.severity === 'error').length,
    warnings: diagnostics.filter((d) => d.severity === 'warning').length,
    diagnostics,
    failedTasks,
  };
}

/**
 * Teşhis kaleminden önerilen aksiyon üretir.
 *
 * Bilinen kalıplar için somut, bilinmeyenler için dürüst bir varsayılan.
 * "Tekrar deneyin" gibi içi boş bir öneri KPI-08'i karşılamaz.
 */
export function suggestAction(diagnostic: Diagnostic): string {
  const message = diagnostic.message.toLowerCase();

  if (message.includes('cannot find symbol')) {
    return diagnostic.symbol
      ? `Eksik sembolü tanımlayın veya import edin: ${diagnostic.symbol}`
      : 'Eksik sembolü tanımlayın veya gerekli import\'u ekleyin.';
  }
  if (message.includes('package') && message.includes('does not exist')) {
    return 'Bağımlılığı build script\'e ekleyin; sürüm sabit olmalıdır (dinamik sürüm yasaktır).';
  }
  if (message.includes('incompatible types') || message.includes('type mismatch')) {
    return 'Tip uyuşmazlığını giderin; beklenen ve verilen tipleri karşılaştırın.';
  }
  if (message.includes('unreported exception')) {
    return 'İstisnayı yakalayın veya metot imzasına ekleyin.';
  }
  if (message.includes('deprecated')) {
    return 'Kullanımdan kaldırılmış API yerine güncel karşılığını kullanın.';
  }
  if (message.includes('unresolved reference')) {
    return 'Referansı tanımlayın veya import edin.';
  }
  return 'Derleyici mesajını inceleyip ilgili satırı düzeltin.';
}
