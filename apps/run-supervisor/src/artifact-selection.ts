/**
 * Build çıktısından plugin JAR'ının deterministik seçimi.
 *
 * docs/product/scope.md: "Build artifact adaylarının deterministik seçimi."
 *
 * Belirsizlik SESSİZCE çözülmez: iki aday varsa `ARTIFACT_AMBIGUOUS` üretilir.
 * "En yenisini seç" gibi bir kural, kaynak değişmeden farklı artifact'lerin
 * seçilmesine yol açar ve provenance zincirini yalancı yapardı.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

export class ArtifactError extends Error {
  constructor(
    readonly code: 'ARTIFACT_NOT_FOUND' | 'ARTIFACT_AMBIGUOUS',
    message: string,
    readonly candidates: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ArtifactError';
  }
}

export interface ArtifactCandidate {
  /** Proje köküne göre yol. */
  readonly path: string;
  readonly absolutePath: string;
  readonly byteSize: number;
}

export interface SelectedArtifact extends ArtifactCandidate {
  readonly buildArtifactId: string;
  readonly sha256: string;
}

/** Plugin JAR'ı olamayacak çıktılar. */
const EXCLUDED_SUFFIXES: readonly string[] = ['-sources.jar', '-javadoc.jar', '-tests.jar', '-test.jar'];

/** Gradle'ın plugin JAR'ı ürettiği bilinen dizinler. */
const OUTPUT_DIRS: readonly string[] = [join('build', 'libs')];

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

export async function findArtifactCandidates(projectRoot: string): Promise<ArtifactCandidate[]> {
  const candidates: ArtifactCandidate[] = [];

  for (const dir of OUTPUT_DIRS) {
    const full = join(projectRoot, dir);
    if (!existsSync(full)) continue;

    for (const name of (await readdir(full)).sort()) {
      if (!name.endsWith('.jar')) continue;
      if (EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix))) continue;

      const absolutePath = join(full, name);
      const stats = await stat(absolutePath);
      if (!stats.isFile()) continue;

      candidates.push({
        path: toPosix(relative(projectRoot, absolutePath)),
        absolutePath,
        byteSize: stats.size,
      });
    }
  }

  return candidates;
}

export interface SelectOptions {
  /**
   * Proje test contract'ının bildirdiği beklenen JAR adı.
   *
   * Belirsizliği çözmenin TEK meşru yolu budur: karar projeye aittir, sezgisel
   * bir kurala değil.
   */
  readonly expectedFileName?: string | undefined;
}

export async function selectArtifact(
  projectRoot: string,
  options: SelectOptions = {},
): Promise<SelectedArtifact> {
  const candidates = await findArtifactCandidates(projectRoot);

  if (candidates.length === 0) {
    throw new ArtifactError(
      'ARTIFACT_NOT_FOUND',
      'Build çıktısında plugin JAR\'ı bulunamadı.\n' +
        'Önerilen aksiyon: Gradle jar/shadowJar görevinin çalıştığını ve build/libs altına çıktı ürettiğini doğrulayın.',
    );
  }

  let chosen: ArtifactCandidate | undefined;

  if (options.expectedFileName) {
    chosen = candidates.find((c) => c.path.endsWith(`/${options.expectedFileName}`) || c.path === options.expectedFileName);
    if (!chosen) {
      throw new ArtifactError(
        'ARTIFACT_NOT_FOUND',
        `Test contract "${options.expectedFileName}" bekliyor fakat çıktıda yok.\n` +
          'Önerilen aksiyon: beklenen dosya adını veya build yapılandırmasını düzeltin.',
        candidates.map((c) => c.path),
      );
    }
  } else if (candidates.length > 1) {
    throw new ArtifactError(
      'ARTIFACT_AMBIGUOUS',
      `Birden fazla aday artifact bulundu; deterministik seçim yapılamadı.\n` +
        `  adaylar: ${candidates.map((c) => c.path).join(', ')}\n` +
        'Önerilen aksiyon: tek bir plugin JAR\'ı üretin veya test contract\'ında beklenen dosya adını belirtin.',
      candidates.map((c) => c.path),
    );
  } else {
    chosen = candidates[0];
  }

  const bytes = await readFile(chosen!.absolutePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  return {
    ...chosen!,
    buildArtifactId: `bart_${sha256.slice(0, 24)}`,
    sha256,
  };
}
