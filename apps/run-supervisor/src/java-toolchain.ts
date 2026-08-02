/**
 * Java toolchain tespiti ve doğrulaması.
 *
 * Profil kuralı: "No runtime is started on a Java major other than
 * java.runtime_major." Yanlış Java ile başlatılan bir Paper, teşhisi zor
 * sınıf dosyası hatalarıyla çöker; erken ve açık hata vermek zorundayız
 * (KPI-08).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export class JavaToolchainError extends Error {
  constructor(
    readonly code: 'JAVA_VERSION_MISMATCH' | 'JAVA_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'JavaToolchainError';
  }
}

export interface JavaInstallation {
  readonly executable: string;
  readonly major: number;
  readonly versionString: string;
}

/**
 * `java -version` çıktısından major sürümü çıkarır.
 *
 * Java 9 öncesi "1.8.0_481" biçimini kullanır; sonrası "25.0.4" biçimini.
 * İkisini de doğru okumak gerekir, aksi hâlde JRE 8 "sürüm 1" sanılır.
 */
export function parseJavaMajor(output: string): number | null {
  const m = /version "([^"]+)"/.exec(output);
  if (!m?.[1]) return null;

  const raw = m[1];
  const legacy = /^1\.(\d+)/.exec(raw);
  if (legacy?.[1]) return Number.parseInt(legacy[1], 10);

  const modern = /^(\d+)/.exec(raw);
  return modern?.[1] ? Number.parseInt(modern[1], 10) : null;
}

/** Shell KULLANILMAZ: process argüman dizisiyle başlatılır (PR-01, PR-02). */
export async function probeJava(executable: string): Promise<JavaInstallation> {
  let output: string;
  try {
    const result = await execFileAsync(executable, ['-version'], { timeout: 15_000 });
    // `java -version` tarihsel olarak stderr'e yazar.
    output = `${result.stderr}\n${result.stdout}`;
  } catch (err) {
    throw new JavaToolchainError(
      'JAVA_NOT_FOUND',
      `Java çalıştırılamadı: ${executable} (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const major = parseJavaMajor(output);
  if (major === null) {
    throw new JavaToolchainError('JAVA_NOT_FOUND', `Java sürümü ayrıştırılamadı:\n${output.trim()}`);
  }

  const versionLine = output.split('\n').find((l) => l.includes('version "'))?.trim() ?? output.trim();
  return { executable, major, versionString: versionLine };
}

/** JAVA_HOME varsa oradaki java'yı, yoksa PATH'teki java'yı kullanır. */
export function candidateJavaExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const home = env['JAVA_HOME'];
  if (home) {
    const exe = join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (existsSync(exe)) return exe;
  }
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

export function assertJavaMajor(installation: JavaInstallation, requiredMajor: number): void {
  if (installation.major !== requiredMajor) {
    throw new JavaToolchainError(
      'JAVA_VERSION_MISMATCH',
      `Java ${requiredMajor} gerekiyor, bulunan ${installation.major}.\n` +
        `  çalıştırılabilir: ${installation.executable}\n` +
        `  sürüm           : ${installation.versionString}\n` +
        `Önerilen aksiyon: JAVA_HOME değerini Java ${requiredMajor} kurulumuna yönlendirin.`,
    );
  }
}

export async function resolveJavaForProfile(requiredMajor: number): Promise<JavaInstallation> {
  const installation = await probeJava(candidateJavaExecutable());
  assertJavaMajor(installation, requiredMajor);
  return installation;
}
