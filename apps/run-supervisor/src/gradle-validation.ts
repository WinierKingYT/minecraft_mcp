/**
 * Gradle supply-chain doğrulaması — `project_validate` capability'sinin çekirdeği.
 *
 * docs/security/supply-chain.md. Bulgular toplanır ve TÜMÜ raporlanır: ilk
 * hatada durmak, kullanıcıyı aynı projeyi defalarca çalıştırmaya zorlar ve
 * eksik olan diğer kontrolleri gizler.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
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

export interface GradleValidationResult {
  readonly ok: boolean;
  readonly findings: readonly ValidationFinding[];
  readonly wrapper: {
    readonly version: string | null;
    readonly distributionUrl: string | null;
    readonly distributionSha256: string | null;
    readonly wrapperJarSha256: string | null;
  };
}

export interface GradleValidationOptions {
  /** `distributionUrl` için izin verilen host listesi. */
  readonly distributionHostAllowlist: readonly string[];
  /** Beklenen Gradle sürümü (uyumluluk profilinden). */
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
  /** Release profilinde lock ve verification metadata zorunludur. */
  readonly requireLockAndVerification?: boolean;
}

const WRAPPER_PROPERTIES = join('gradle', 'wrapper', 'gradle-wrapper.properties');
const WRAPPER_JAR = join('gradle', 'wrapper', 'gradle-wrapper.jar');
const VERIFICATION_METADATA = join('gradle', 'verification-metadata.xml');

/** Build script'lerinde aranan dinamik sürüm kalıpları. */
const DYNAMIC_VERSION_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  { pattern: /(["'])[^"']*:\+\1/g, label: 'artı (+) joker sürüm' },
  { pattern: /(["'])[^"']*:[^"']*\+\1/g, label: 'artı (+) joker sürüm' },
  { pattern: /latest\.(release|integration)/gi, label: 'latest.release / latest.integration' },
  { pattern: /(["'])[^"']*:\[[^\]]+[),\]]\1/g, label: 'sürüm aralığı' },
];

const SNAPSHOT_PATTERN = /(["'])[^"']*-SNAPSHOT\1/g;
const CHANGING_PATTERN = /isChanging\s*=\s*true|changing\s*=\s*true/g;

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

export function extractGradleVersion(distributionUrl: string): string | null {
  const match = /gradle-([0-9]+(?:\.[0-9]+)*)-(bin|all)\.zip$/.exec(distributionUrl);
  return match?.[1] ?? null;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Build script dosyalarını toplar (kök seviye, alt projeler hariç — M1 kapsamı). */
async function buildScripts(root: string): Promise<string[]> {
  const names = ['build.gradle.kts', 'build.gradle', 'settings.gradle.kts', 'settings.gradle'];
  const found: string[] = [];
  for (const name of names) {
    if (existsSync(join(root, name))) found.push(name);
  }
  return found;
}

export async function validateGradleProject(
  root: string,
  options: GradleValidationOptions,
): Promise<GradleValidationResult> {
  const findings: ValidationFinding[] = [];
  const add = (finding: ValidationFinding): void => {
    findings.push(finding);
  };

  // ---- Wrapper varlığı ----------------------------------------------------
  const wrapperFiles = [
    { path: 'gradlew', label: 'gradlew' },
    { path: 'gradlew.bat', label: 'gradlew.bat' },
    { path: WRAPPER_JAR, label: 'gradle-wrapper.jar' },
    { path: WRAPPER_PROPERTIES, label: 'gradle-wrapper.properties' },
  ];

  const missing = wrapperFiles.filter((f) => !existsSync(join(root, f.path)));
  if (missing.length > 0) {
    add({
      code: 'GRADLE_WRAPPER_NOT_FOUND',
      severity: 'error',
      message: `Gradle Wrapper dosyaları eksik: ${missing.map((m) => m.label).join(', ')}`,
      suggestedAction:
        'Projeye Gradle Wrapper ekleyin (`gradle wrapper`); yalnızca wrapper üzerinden build çalıştırılır.',
    });
    return { ok: false, findings, wrapper: { version: null, distributionUrl: null, distributionSha256: null, wrapperJarSha256: null } };
  }

  // ---- Wrapper JAR checksum -----------------------------------------------
  const wrapperJarSha256 = await sha256File(join(root, WRAPPER_JAR));
  if (!options.knownWrapperJarSha256.includes(wrapperJarSha256)) {
    add({
      code: 'GRADLE_WRAPPER_JAR_UNVERIFIED',
      severity: 'error',
      message: `gradle-wrapper.jar bilinen-iyi checksum listesinde yok (${wrapperJarSha256}).`,
      suggestedAction:
        'Wrapper\'ı checksum\'ı doğrulanmış bir Gradle dağıtımından yeniden üretin; ' +
        'wrapper JAR build\'den önce çalışan koddur.',
      path: WRAPPER_JAR,
    });
  }

  // ---- Wrapper properties -------------------------------------------------
  const properties = parseProperties(await readFile(join(root, WRAPPER_PROPERTIES), 'utf8'));
  const distributionUrl = properties.get('distributionUrl') ?? null;
  const distributionSha256 = properties.get('distributionSha256Sum') ?? null;
  const version = distributionUrl ? extractGradleVersion(distributionUrl) : null;

  if (!distributionUrl) {
    add({
      code: 'GRADLE_DISTRIBUTION_URL_UNAPPROVED',
      severity: 'error',
      message: 'gradle-wrapper.properties içinde distributionUrl yok.',
      suggestedAction: 'distributionUrl değerini resmî Gradle dağıtımına ayarlayın.',
      path: WRAPPER_PROPERTIES,
    });
  } else {
    const host = hostOf(distributionUrl);
    if (host === null || !options.distributionHostAllowlist.includes(host)) {
      add({
        code: 'GRADLE_DISTRIBUTION_URL_UNAPPROVED',
        severity: 'error',
        message: `distributionUrl allowlist dışında: ${host ?? distributionUrl}`,
        suggestedAction: `İzin verilen host'lar: ${options.distributionHostAllowlist.join(', ')}`,
        path: WRAPPER_PROPERTIES,
      });
    }
    if (!distributionUrl.startsWith('https://')) {
      add({
        code: 'GRADLE_DISTRIBUTION_URL_UNAPPROVED',
        severity: 'error',
        message: 'distributionUrl HTTPS değil.',
        suggestedAction: 'Dağıtımı yalnızca HTTPS üzerinden indirin.',
        path: WRAPPER_PROPERTIES,
      });
    }
  }

  if (!distributionSha256) {
    add({
      code: 'GRADLE_DISTRIBUTION_CHECKSUM_MISSING',
      severity: 'error',
      message: 'gradle-wrapper.properties içinde distributionSha256Sum yok.',
      suggestedAction: 'Resmî checksum endpoint\'inden alınan SHA-256 değerini ekleyin.',
      path: WRAPPER_PROPERTIES,
    });
  } else if (
    options.expectedDistributionSha256 &&
    version === options.expectedVersion &&
    distributionSha256.toLowerCase() !== options.expectedDistributionSha256.toLowerCase()
  ) {
    add({
      code: 'GRADLE_DISTRIBUTION_CHECKSUM_INVALID',
      severity: 'error',
      message:
        `distributionSha256Sum profildeki değerle eşleşmiyor.\n` +
        `  profil: ${options.expectedDistributionSha256}\n  proje : ${distributionSha256}`,
      suggestedAction: 'Dağıtımı yeniden indirin ve resmî checksum ile karşılaştırın.',
      path: WRAPPER_PROPERTIES,
    });
  }

  if (version !== null && version !== options.expectedVersion) {
    add({
      code: 'GRADLE_VERSION_INCOMPATIBLE',
      severity: 'error',
      message: `Wrapper sürümü ${version}; uyumluluk profili ${options.expectedVersion} bekliyor.`,
      suggestedAction: `Wrapper'ı ${options.expectedVersion} sürümüne güncelleyin.`,
      path: WRAPPER_PROPERTIES,
    });
  }

  // ---- Lock ve verification metadata --------------------------------------
  const lockFiles = (await readdir(root).catch(() => [])).filter((f) => f === 'gradle.lockfile');
  const hasLockDir = existsSync(join(root, 'gradle', 'dependency-locks'));

  if (options.requireLockAndVerification !== false && lockFiles.length === 0 && !hasLockDir) {
    add({
      code: 'DEPENDENCY_LOCK_MISSING',
      severity: 'error',
      message: 'Dependency lock dosyası bulunamadı.',
      suggestedAction: 'Onaylı provisioning workflow ile `./gradlew dependencies --write-locks` çalıştırın.',
    });
  }

  if (options.requireLockAndVerification !== false && !existsSync(join(root, VERIFICATION_METADATA))) {
    add({
      code: 'DEPENDENCY_VERIFICATION_MISSING',
      severity: 'error',
      message: 'gradle/verification-metadata.xml bulunamadı.',
      suggestedAction:
        'Onaylı provisioning workflow ile `./gradlew --write-verification-metadata sha256 build` çalıştırın; ' +
        'çıktı manuel review bekler.',
    });
  } else if (existsSync(join(root, VERIFICATION_METADATA))) {
    const xml = await readFile(join(root, VERIFICATION_METADATA), 'utf8');
    if (/<verify-metadata>\s*false\s*<\/verify-metadata>/i.test(xml)) {
      add({
        code: 'DEPENDENCY_VERIFICATION_MISSING',
        severity: 'error',
        message: 'verification-metadata.xml içinde verify-metadata kapalı.',
        suggestedAction: 'verify-metadata değerini true yapın; kapalı doğrulama, dosyanın varlığını anlamsız kılar.',
        path: VERIFICATION_METADATA,
      });
    }
    if (!/sha256|sha512/i.test(xml)) {
      add({
        code: 'DEPENDENCY_VERIFICATION_MISSING',
        severity: 'error',
        message: 'verification-metadata.xml SHA-256/SHA-512 checksum içermiyor.',
        suggestedAction: 'Metadata\'yı sha256 ile yeniden üretin; zayıf algoritmalar kabul edilmez.',
        path: VERIFICATION_METADATA,
      });
    }
  }

  // ---- Dinamik sürüm ve changing module taraması --------------------------
  for (const script of await buildScripts(root)) {
    const text = await readFile(join(root, script), 'utf8');
    const lines = text.split(/\r?\n/);

    lines.forEach((line, index) => {
      // Yorum satırları taranmaz: örnek gösteren bir yorum bulgu üretmemeli.
      const code = line.replace(/\/\/.*$/, '').replace(/#.*$/, '');

      for (const { pattern, label } of DYNAMIC_VERSION_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(code)) {
          add({
            code: 'DYNAMIC_DEPENDENCY_FORBIDDEN',
            severity: 'error',
            message: `Dinamik sürüm ifadesi (${label}): ${code.trim().slice(0, 80)}`,
            suggestedAction: 'Sürümü sabit bir değere pinleyin; dinamik sürüm reproducible build\'i imkânsız kılar.',
            path: script,
            line: index + 1,
          });
        }
      }

      SNAPSHOT_PATTERN.lastIndex = 0;
      if (SNAPSHOT_PATTERN.test(code)) {
        add({
          code: 'CHANGING_MODULE_FORBIDDEN',
          severity: 'error',
          message: `SNAPSHOT bağımlılığı: ${code.trim().slice(0, 80)}`,
          suggestedAction: 'SNAPSHOT bağımlılığını yayınlanmış bir sürümle değiştirin.',
          path: script,
          line: index + 1,
        });
      }

      CHANGING_PATTERN.lastIndex = 0;
      if (CHANGING_PATTERN.test(code)) {
        add({
          code: 'CHANGING_MODULE_FORBIDDEN',
          severity: 'error',
          message: `Changing module işaretlenmiş: ${code.trim().slice(0, 80)}`,
          suggestedAction: 'Changing module kullanmayın; içerik sabitlenemez.',
          path: script,
          line: index + 1,
        });
      }
    });
  }

  return {
    ok: findings.every((f) => f.severity !== 'error'),
    findings,
    wrapper: { version, distributionUrl, distributionSha256, wrapperJarSha256 },
  };
}
