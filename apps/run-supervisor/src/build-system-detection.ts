/**
 * Build sistemi tespiti — `project_validate`'nin hangi doğrulayıcıyı
 * çalıştıracağına karar verir.
 *
 * Ürün yalnızca wrapper-pinned build sistemlerini destekler (gradlew /
 * mvnw). Dört durum açıkça hardedilir; sessiz varsayım YOKTUR: hiçbir
 * wrapper yoksa `not-found`, ikisi birden varsa `ambiguous` döner
 * (bkz. docs/security/supply-chain.md, BUILD_SYSTEM_* kodları).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type BuildSystemState =
  | { readonly state: 'gradle' }
  | { readonly state: 'maven' }
  | { readonly state: 'not-found' }
  | { readonly state: 'ambiguous' };

/** Bir build sisteminin varlığını gösteren wrapper dosyalarını arar. */
export function detectBuildSystem(canonicalRoot: string): BuildSystemState {
  const hasGradle =
    existsSync(join(canonicalRoot, 'gradlew')) || existsSync(join(canonicalRoot, 'gradlew.bat'));
  const hasMaven =
    existsSync(join(canonicalRoot, 'mvnw')) || existsSync(join(canonicalRoot, 'mvnw.cmd'));

  if (hasGradle && hasMaven) return { state: 'ambiguous' };
  if (hasGradle) return { state: 'gradle' };
  if (hasMaven) return { state: 'maven' };
  return { state: 'not-found' };
}