/**
 * Trusted Local execution backend.
 *
 * <strong>Bu bir sandbox DEĞİLDİR.</strong> Kötü niyetli Java veya Gradle
 * koduna karşı host izolasyonu sağlamaz; aynı kullanıcı yetkileriyle çalışan
 * kodu tam olarak sınırlandıramaz. Sağladığı kontroller (ADR-0004,
 * docs/security/guarantees.md):
 *
 *   - canonical path confinement
 *   - environment allowlist
 *   - ayrı HOME ve ayrı Gradle user home
 *   - timeout (tüm process tree'ye)
 *   - output byte limiti
 *   - shell kullanılmaması
 *   - açık ağ politikası
 *   - audit
 */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { forceKill } from './runtime-launch.js';
import type { BuildPlan } from './build-plan.js';

export class BuildExecutionError extends Error {
  constructor(
    readonly code: 'BUILD_FAILED' | 'BUILD_TIMEOUT' | 'OUTPUT_LIMIT_EXCEEDED' | 'ENVIRONMENT_VARIABLE_NOT_ALLOWED',
    message: string,
    readonly output?: string,
  ) {
    super(message);
    this.name = 'BuildExecutionError';
  }
}

/**
 * Build process'ine aktarılan environment değişkenleri.
 *
 * Host ortamı OLDUĞU GİBİ aktarılmaz: `GRADLE_OPTS`, `JAVA_TOOL_OPTIONS`,
 * `_JAVA_OPTIONS` gibi değişkenler build'e keyfî JVM argümanı enjekte etmenin
 * bilinen yollarıdır ve bilinçli olarak listede yoktur.
 */
const ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'JAVA_HOME',
  'SystemRoot',
  'SystemDrive',
  'ComSpec',
  'PATHEXT',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'LANG',
  'LC_ALL',
  'TZ',
];

/** Allowlist dışında kalırsa build'i sessizce bozan bilinen değişkenler. */
export const DANGEROUS_ENV_VARS: readonly string[] = [
  'GRADLE_OPTS',
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'GRADLE_USER_HOME',
  'CLASSPATH',
];

export interface BuildEnvironment {
  readonly env: Readonly<Record<string, string>>;
  readonly gradleUserHome: string;
  readonly tempHome: string;
}

/**
 * Build ortamını kurar.
 *
 * `GRADLE_USER_HOME` ve `HOME` runtime'a özel geçici dizinlere yönlendirilir:
 * build, kullanıcının gerçek Gradle cache'ini ve ev dizinini kirletmez ve
 * oradan bir şey okuyamaz (ST-FS-002).
 */
export async function prepareEnvironment(
  workDir: string,
  source: NodeJS.ProcessEnv = process.env,
  dependencyCacheDir?: string,
): Promise<BuildEnvironment> {
  // Dependency cache build'ler ARASINDA paylaşılır; HOME ve TEMP her build'e
  // özeldir. Cache paylaşılmasaydı reproducible (offline) mod hiçbir zaman
  // çalışamazdı: boş bir cache ile ağ kapalıyken bağımlılık çözülemez.
  const gradleUserHome = dependencyCacheDir ?? join(workDir, 'gradle-home');
  const tempHome = join(workDir, 'home');
  await mkdir(gradleUserHome, { recursive: true });
  await mkdir(tempHome, { recursive: true });

  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }

  env['GRADLE_USER_HOME'] = gradleUserHome;
  env['HOME'] = tempHome;
  env['USERPROFILE'] = tempHome;
  env['TEMP'] = join(workDir, 'tmp');
  env['TMP'] = env['TEMP'];
  // Determinizm: yerel ayarlar sabitlenir.
  env['LANG'] = 'en_US.UTF-8';
  env['TZ'] = 'UTC';

  await mkdir(env['TEMP'], { recursive: true });

  return { env, gradleUserHome, tempHome };
}

/** Allowlist dışı bir değişkenin sızmadığını doğrular (ST-ENV-001). */
export function assertEnvironmentClean(env: Readonly<Record<string, string>>): void {
  for (const dangerous of DANGEROUS_ENV_VARS) {
    if (dangerous === 'GRADLE_USER_HOME') continue; // bilinçli olarak biz set ediyoruz
    if (env[dangerous] !== undefined) {
      throw new BuildExecutionError(
        'ENVIRONMENT_VARIABLE_NOT_ALLOWED',
        `Build ortamında izin verilmeyen değişken: ${dangerous}. ` +
          'Bu değişkenler build\'e keyfî JVM argümanı enjekte edebilir.',
      );
    }
  }
}

export interface RunBuildOptions {
  readonly projectRoot: string;
  readonly workDir: string;
  readonly plan: BuildPlan;
  /** Uyumluluk profilinde doğrulanmış Java çalıştırılabiliri. */
  readonly javaExecutable: string;
  /**
   * Build'ler arasında paylaşılan Gradle user home.
   *
   * Reproducible (offline) modun ön koşuludur: cache provisioning modunda
   * doldurulur, offline modda yeniden kullanılır. Verilmezse her build kendi
   * boş cache'iyle çalışır ve offline mod bağımlılık çözemez.
   */
  readonly dependencyCacheDir?: string;
  readonly onLogLine?: (line: string) => void;
}

export interface BuildRunResult {
  readonly exitCode: number | null;
  readonly output: string;
  readonly truncated: boolean;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly command: string;
  readonly args: readonly string[];
}

/** Wrapper JAR'ının konumu — checksum'ı `project_validate` tarafından doğrulanır. */
export function wrapperJarPath(projectRoot: string): string {
  return join(projectRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar');
}

/** `gradlew` / `gradlew.bat` script'lerinin çalıştırdığı ana sınıf. */
export const GRADLE_WRAPPER_MAIN = 'org.gradle.wrapper.GradleWrapperMain';

/**
 * Build komutunu kurar.
 *
 * `gradlew` / `gradlew.bat` script'leri ÇALIŞTIRILMAZ; bunun yerine wrapper
 * JAR'ının ana sınıfı doğrudan Java ile başlatılır. Üç nedeni var:
 *
 *   1. Windows'ta `.bat` dosyasını shell olmadan başlatmak mümkün değildir;
 *      `shell: true` ise proje yolundaki bir metakarakteri komut enjeksiyonuna
 *      çevirir (PR-01 ihlali).
 *   2. Script'ler doğrulanmamış metindir; wrapper JAR'ın checksum'ı ise
 *      `project_validate` tarafından bilinen-iyi listesine karşı doğrulanır.
 *   3. Java çalıştırılabiliri uyumluluk profiliyle sabitlenmiştir; script'in
 *      PATH'ten bulduğu Java sürprizi ortadan kalkar.
 */
export function buildCommand(
  projectRoot: string,
  javaExecutable: string,
  plan: BuildPlan,
): { command: string; args: string[] } {
  return {
    command: javaExecutable,
    args: ['-classpath', wrapperJarPath(projectRoot), GRADLE_WRAPPER_MAIN, ...plan.args],
  };
}

export async function runBuild(options: RunBuildOptions): Promise<BuildRunResult> {
  const { projectRoot, workDir, plan, javaExecutable } = options;
  const environment = await prepareEnvironment(workDir, process.env, options.dependencyCacheDir);
  assertEnvironmentClean(environment.env);

  const { command, args } = buildCommand(projectRoot, javaExecutable, plan);
  const started = Date.now();

  // PR-01/PR-02: shell yok, argüman dizisi var. `shell: true` olsaydı proje
  // yolundaki bir metakarakter komut enjeksiyonuna dönüşürdü.
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: environment.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
    shell: false,
  });

  let output = '';
  let truncated = false;
  let timedOut = false;

  const capture = (chunk: Buffer): void => {
    if (truncated) return;
    const text = chunk.toString('utf8');

    if (output.length + text.length > plan.maxOutputBytes) {
      output += text.slice(0, Math.max(0, plan.maxOutputBytes - output.length));
      truncated = true;
      output += '\n[OUTPUT_LIMIT_EXCEEDED: çıktı kesildi]\n';
      return;
    }
    output += text;
    if (options.onLogLine) {
      for (const line of text.split(/\r?\n/)) {
        if (line.trim() !== '') options.onLogLine(line);
      }
    }
  };

  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  const exitCode = await new Promise<number | null>((resolve) => {
    // PR-06: timeout tüm process tree'ye uygulanır.
    const timer = setTimeout(() => {
      timedOut = true;
      void forceKill(child);
    }, plan.timeoutMs);

    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });

  return {
    exitCode,
    output,
    truncated,
    durationMs: Date.now() - started,
    timedOut,
    command,
    args,
  };
}
