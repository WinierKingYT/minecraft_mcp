// pnpm (Node) ve Gradle (Java) lockfile ayrıştırıcıları — tek gerçek kaynak.
// `generate-sbom.mjs` ve `dependency-scan.mjs` bu modülü kullanır; lockfile'lar
// iki farklı şekilde okunamaz (ikinci bir okuma yolu kurgu kayması üretir).

import { readFileSync, existsSync } from 'node:fs';

/**
 * pnpm-lock.yaml (v9) -> component listesi.
 *
 * `packages:` bölümündeki girişleri okur; workspace link'leri (`link:`),
 * sürümü sayı ile başlamayanlar ve katalog benzeri satırlar atlanır.
 */
export function parsePnpmLockfile(lockfilePath) {
  if (!existsSync(lockfilePath)) return [];

  const content = readFileSync(lockfilePath, 'utf-8');
  const components = [];
  const seen = new Set();

  const packagesIdx = content.indexOf('\npackages:\n');
  if (packagesIdx < 0) return [];

  const lines = content.slice(packagesIdx).split('\n');

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith('  ') || !trimmed.endsWith(':')) continue;

    const entry = trimmed.slice(2, -1).trim();
    if (!entry.includes('@')) continue;

    const unquoted = entry.replace(/^['"]|['"]$/g, '');
    const atIdx = unquoted.lastIndexOf('@');
    if (atIdx <= 0) continue;

    const name = unquoted.slice(0, atIdx);
    const version = unquoted.slice(atIdx + 1);
    if (!/^\d/.test(version)) continue;

    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    components.push({
      type: 'library',
      name,
      version,
      purl: `pkg:npm/${encodeURIComponent(name)}@${version}`,
      scope: 'required',
      ecosystem: 'npm',
    });
  }

  return components;
}

/**
 * gradle.lockfile -> component listesi.
 *
 * Biçim: `group:artifact:version=configuration`. Yorum ve başlık satırları
 * atlanır; sürüm parçası iki nokta üst üste içermez.
 */
export function parseGradleLockfile(lockfilePath) {
  if (!existsSync(lockfilePath)) return [];

  const content = readFileSync(lockfilePath, 'utf-8');
  const components = [];
  const seen = new Set();

  const lineRegex = /^([^#=]+)=.+$/gm;
  let match;

  while ((match = lineRegex.exec(content)) !== null) {
    const dep = match[1]?.trim();
    if (!dep || dep.startsWith('#')) continue;

    const parts = dep.split(':');
    if (parts.length < 3) continue;

    const [group, artifact, version] = parts;
    if (!group || !artifact || !version) continue;

    const key = `${group}:${artifact}:${version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    components.push({
      type: 'library',
      name: `${group}:${artifact}`,
      version,
      purl: `pkg:maven/${encodeURIComponent(group)}/${encodeURIComponent(artifact)}@${version}`,
      scope: 'required',
      ecosystem: 'maven',
    });
  }

  return components;
}
