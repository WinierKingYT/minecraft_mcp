/**
 * Maven Wrapper supply-chain doğrulaması — Gradle aynası.
 *
 * Gradle'ın birebir karşılığı olan bir modüldür; aynı kural felsefesini Maven
 * projelerine uygular (docs/security/supply-chain.md). Bulgular toplanır ve
 * TÜMÜ raporlanır: ilk hatada durmak, kullanıcıyı aynı projeyi defalarca
 * çalıştırmaya zorlar ve eksik olan diğer kontrolleri gizler.
 *
 * Maven'a özgü farklar (bilinçli):
 *   - Wrapper JAR, maven-wrapper 3.2+ `distributionType=only-script`
 *     modunda projede bulunmayabilir; yalnızca mevcutsa doğrulanır.
 *   - Maven'ın standardı gereği lock/verification-metadata Gradle'daki gibi
 *     dosya tabanlı değildir; bu kontroller Gradle tarafına aittir.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type FindingSeverity = 'error' | 'warning';

export interface ValidationFinding {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly message: string;
  /** KPI-08: her bulgu önerilen aksiyon taşır. */
  readonly suggestedAction: string;
  readonly path?: string;
  readonly line?: number;
}

export interface MavenValidationResult {
  readonly ok: boolean;
  readonly findings: readonly ValidationFinding[];
  readonly wrapper: {
    readonly version: string | null;
    readonly distributionUrl: string | null;
    readonly distributionSha256: string | null;
    readonly wrapperJarSha256: string | null;
    readonly wrapperJarPresent: boolean;
  };
}

export interface MavenValidationOptions {
  /** `distributionUrl` için izin verilen host listesi. */
  readonly distributionHostAllowlist: readonly string[];
  /** Beklenen Maven sürümü (uyumluluk profilinden). */
  readonly expectedVersion: string;
  /** Beklenen dağıtım SHA-256 (uyumluluk profilinden). */
  readonly expectedDistributionSha256: string | null;
  /**
   * Bilinen-iyi wrapper JAR checksum'ları.
   *
   * Wrapper JAR çalıştırılabilir koddur ve build başlamadan ÖNCE çalışır;
   * doğrulanmamış bir wrapper JAR, tüm supply-chain kontrollerini atlatabilir.
   */
  readonly knownWrapperJarSha256: readonly string[];
}

const MAVEN_WRAPPER_PROPERTIES = join('.mvn', 'wrapper', 'maven-wrapper.properties');
const MAVEN_WRAPPER_JAR = join('.mvn', 'wrapper', 'maven-wrapper.jar');

/**
 * pom.xml içinde aranan dinamik sürüm kalıpları.
 *
 * Maven sürüm aralıkları `[1.0,2.0)`, `[1.0]` gibi köşeli parantez kullanır;
 * `LATEST` / `RELEASE` hareketli sürüm ifadeleridir; `1.+` sürüm 3.5+
 * "floating version" ifadesidir.
 */
const DYNAMIC_VERSION_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  { pattern: />\s*[\[(][^<]*<\/version>/g, label: 'sürüm aralığı' },
  { pattern: />LATEST<\/version>/gi, label: 'LATEST hareketli sürüm' },
  { pattern: />RELEASE<\/version>/gi, label: 'RELEASE hareketli sürüm' },
  { pattern: />\d+\.\d+\.\+<\/version>/g, label: 'floating version (n.+ joker)' },
];

const SNAPSHOT_PATTERN = />[^<]*-\$\{?[^<]*SNAPSHOT[^<]*<\/version>/gi;
const SNAPSHOT_LITERAL_PATTERN = />[^<]*-SNAPSHOT<\/version>/gi;

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function parseProperties(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    // Properties biçiminde ':' kaçırılmıştır (`https\://...`).
    map.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim().replace(/\\:/g, ':'));
  }
  return map;
}

export function extractMavenVersion(distributionUrl: string): string | null {
  const match = /apache-maven-([0-9]+(?:\.[0-9]+)*)-bin\.zip$/.exec(distributionUrl);
  return match?.[1] ?? null;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function validateMavenProject(
  root: string,
  options: MavenValidationOptions,
): Promise<MavenValidationResult> {
  const findings: ValidationFinding[] = [];
  const add = (finding: ValidationFinding): void => {
    findings.push(finding);
  };

  // ---- Wrapper varlığı ----------------------------------------------------
  const wrapperFiles = [
    { path: 'mvnw', label: 'mvnw' },
    { path: 'mvnw.cmd', label: 'mvnw.cmd' },
    { path: MAVEN_WRAPPER_PROPERTIES, label: 'maven-wrapper.properties' },
  ];

  const missing = wrapperFiles.filter((f) => !existsSync(join(root, f.path)));
  if (missing.length > 0) {
    add({
      code: 'MVN_WRAPPER_NOT_FOUND',
      severity: 'error',
      message: `Maven Wrapper dosyaları eksik: ${missing.map((m) => m.label).join(', ')}`,
      suggestedAction:
        'Projeye Maven Wrapper ekleyin (`mvn wrapper:wrapper`); yalnızca wrapper üzerinden build çalıştırılır.',
    });
    return {
      ok: false,
      findings,
      wrapper: { version: null, distributionUrl: null, distributionSha256: null, wrapperJarSha256: null, wrapperJarPresent: false },
    };
  }

  // ---- Wrapper JAR checksum -----------------------------------------------
  // maven-wrapper 3.2+ `distributionType=only-script` modunda JAR bulunmayabilir.
  // Bu yüzden "yok" bir bulgu değildir; "var fakat bilinmiyor" bulgudur.
  const wrapperJarPresent = existsSync(join(root, MAVEN_WRAPPER_JAR));
  let wrapperJarSha256: string | null = null;
  if (wrapperJarPresent) {
    wrapperJarSha256 = await sha256File(join(root, MAVEN_WRAPPER_JAR));
    if (!options.knownWrapperJarSha256.includes(wrapperJarSha256)) {
      add({
        code: 'MVN_WRAPPER_JAR_UNVERIFIED',
        severity: 'error',
        message: `maven-wrapper.jar bilinen-iyi checksum listesinde yok (${wrapperJarSha256}).`,
        suggestedAction:
          'Wrapper JAR\'ı doğrulanmış bir Maven dağıtımından yeniden üretin; ' +
          'wrapper JAR build\'den önce çalışan koddur.',
        path: MAVEN_WRAPPER_JAR,
      });
    }
  }

  // ---- Wrapper properties -------------------------------------------------
  const properties = parseProperties(await readFile(join(root, MAVEN_WRAPPER_PROPERTIES), 'utf8'));
  const distributionUrl = properties.get('distributionUrl') ?? null;
  const distributionSha256 = properties.get('distributionSha256Sum') ?? null;
  const version = distributionUrl ? extractMavenVersion(distributionUrl) : null;

  if (!distributionUrl) {
    add({
      code: 'MVN_DISTRIBUTION_URL_UNAPPROVED',
      severity: 'error',
      message: 'maven-wrapper.properties içinde distributionUrl yok.',
      suggestedAction: 'distributionUrl değerini resmî Maven dağıtımına ayarlayın.',
      path: MAVEN_WRAPPER_PROPERTIES,
    });
  } else {
    const host = hostOf(distributionUrl);
    if (host === null || !options.distributionHostAllowlist.includes(host)) {
      add({
        code: 'MVN_DISTRIBUTION_URL_UNAPPROVED',
        severity: 'error',
        message: `distributionUrl allowlist dışında: ${host ?? distributionUrl}`,
        suggestedAction: `İzin verilen host'lar: ${options.distributionHostAllowlist.join(', ')}`,
        path: MAVEN_WRAPPER_PROPERTIES,
      });
    }
    if (!distributionUrl.startsWith('https://')) {
      add({
        code: 'MVN_DISTRIBUTION_URL_UNAPPROVED',
        severity: 'error',
        message: 'distributionUrl HTTPS değil.',
        suggestedAction: 'Dağıtımı yalnızca HTTPS üzerinden indirin.',
        path: MAVEN_WRAPPER_PROPERTIES,
      });
    }
  }

  if (!distributionSha256) {
    add({
      code: 'MVN_DISTRIBUTION_CHECKSUM_MISSING',
      severity: 'error',
      message: 'maven-wrapper.properties içinde distributionSha256Sum yok.',
      suggestedAction: 'Resmî checksum endpoint\'inden alınan SHA-256 değerini ekleyin.',
      path: MAVEN_WRAPPER_PROPERTIES,
    });
  } else if (
    options.expectedDistributionSha256 &&
    version === options.expectedVersion &&
    distributionSha256.toLowerCase() !== options.expectedDistributionSha256.toLowerCase()
  ) {
    add({
      code: 'MVN_DISTRIBUTION_CHECKSUM_INVALID',
      severity: 'error',
      message:
        `distributionSha256Sum profildeki değerle eşleşmiyor.\n` +
        `  profil: ${options.expectedDistributionSha256}\n  proje : ${distributionSha256}`,
      suggestedAction: 'Dağıtımı yeniden indirin ve resmî checksum ile karşılaştırın.',
      path: MAVEN_WRAPPER_PROPERTIES,
    });
  }

  if (version !== null && version !== options.expectedVersion) {
    add({
      code: 'MVN_VERSION_INCOMPATIBLE',
      severity: 'error',
      message: `Wrapper sürümü ${version}; uyumluluk profili ${options.expectedVersion} bekliyor.`,
      suggestedAction: `Wrapper'ı ${options.expectedVersion} sürümüne güncelleyin.`,
      path: MAVEN_WRAPPER_PROPERTIES,
    });
  }

  // ---- pom.xml dinamik sürüm ve SNAPSHOT taraması ------------------------
  const pomPath = join(root, 'pom.xml');
  if (existsSync(pomPath)) {
    const text = await readFile(pomPath, 'utf8');
    const lines = text.split(/\r?\n/);

    lines.forEach((line, index) => {
      // XML yorumları ve inline kod örnekleri taranmaz.
      const code = line.replace(/<!--[\s\S]*?-->/g, '');

      for (const { pattern, label } of DYNAMIC_VERSION_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(code)) {
          add({
            code: 'DYNAMIC_DEPENDENCY_FORBIDDEN',
            severity: 'error',
            message: `Dinamik sürüm ifadesi (${label}): ${code.trim().slice(0, 80)}`,
            suggestedAction: 'Sürümü sabit bir değere pinleyin; dinamik sürüm reproducible build\'i imkânsız kılar.',
            path: 'pom.xml',
            line: index + 1,
          });
        }
      }

      SNAPSHOT_LITERAL_PATTERN.lastIndex = 0;
      SNAPSHOT_PATTERN.lastIndex = 0;
      if (SNAPSHOT_LITERAL_PATTERN.test(code) || SNAPSHOT_PATTERN.test(code)) {
        add({
          code: 'CHANGING_MODULE_FORBIDDEN',
          severity: 'error',
          message: `SNAPSHOT bağımlılığı: ${code.trim().slice(0, 80)}`,
          suggestedAction: 'SNAPSHOT bağımlılığını yayınlanmış bir sürümle değiştirin.',
          path: 'pom.xml',
          line: index + 1,
        });
      }
    });
  }

  return {
    ok: findings.every((f) => f.severity !== 'error'),
    findings,
    wrapper: { version, distributionUrl, distributionSha256, wrapperJarSha256, wrapperJarPresent },
  };
}
