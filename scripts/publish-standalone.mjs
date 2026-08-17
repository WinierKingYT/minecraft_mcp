#!/usr/bin/env node
// Publish standalone mcpdev package (Phase 2 — Commit 8).
//
// `mcpdev` paketini (scripts/build-standalone.mjs çıktısı) kayıt defterlerine
// yayınlar:
//
//   node scripts/publish-standalone.mjs --registry npm     (varsayılan)
//   node scripts/publish-standalone.mjs --registry github --scope <owner>
//   node scripts/publish-standalone.mjs --dry-run
//
// Registry kararı (docs/delivery/standalone-vs-monorepo.md):
//   npm    : unscoped `mcpdev` adı — küresel isim, yazma yetkisi gerekir.
//   github : GitHub Packages — `@<owner>/mcpdev` scoped ad nadir; yayın akışı
//            `--scope` ile kopyada adı scoped yapar, kaynak tarafına
//            dokunmaz. Auth token'ı npmrc/ortamdan gelir (NODE_AUTH_TOKEN).
//
// Yayın öncesi kapılar (kendi supply-chain kuralımızla birebir):
//   1. dist-standalone/package/package.json mevcut olmalı (önce build:standalone).
//   2. Tarball SHA-256 yeniden hesaplanır ve SHASUMS.sha256 ile bile eşleşmelidir.
//   3. Dry-run pack ile bundle doğrulanır: yayınlanacak tarball'da
//      node_modules/@mcpdev/* gömülü olmalı (npm pack'in bundle'ı kayıt
//      defteri tarball'ına taşıdığının kanıtı).
//
// `--version <v>` verildiyse source ile birebir eşleşmek zorundadır (hareketli
// sürüm ifadesi yok — DOC-GATE-02).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, rm, mkdtemp, writeFile, readdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-standalone');
const PKG_DIR = join(OUT, 'package');
const BUNDLED_VENDOR = 'node_modules/@mcpdev';
/** Windows'ta npm, .cmd shim'dir; execFileSync yalnızca doğrudan çalıştırılabilir isimleri çözebilir. */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
/** Windows'ta .cmd shim'leri yalnızca shell üzerinden çalışır (execFileSync için shell=true gerekir). */
const EXEC_OPTS = { shell: process.platform === 'win32' };

function die(message) {
  process.stderr.write(`publish-standalone: ${message}\n`);
  process.exit(1);
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const registry = argValue(args, '--registry') ?? 'npm';
  const scope = argValue(args, '--scope');
  const versionPin = argValue(args, '--version');

  if (registry !== 'npm' && registry !== 'github') {
    die(`bilinmeyen registry "${registry}" (npm|github)`);
  }
  if (registry === 'github') {
    if (!scope) die('--registry github için --scope <owner> zorunludur');
    if (!/^@[a-z0-9-]+$/i.test(scope)) die(`--scope "@owner" biçiminde olmalı, aldık: ${scope}`);
  }

  // Kapı 1: build çıktısı mevcut.
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(PKG_DIR, 'package.json'), 'utf8'));
  } catch {
    die('dist-standalone/package/package.json bulunamadı — önce `pnpm run build:standalone` (build + bridge JAR)');
  }
  if (pkg.private === true) die('package.json private=true — yayın engellendi');

  if (versionPin !== undefined && versionPin !== pkg.version) {
    die(`--version ${versionPin} kaynak sürümüyle eşleşmiyor (${pkg.version})`);
  }

  // Kapı 2: tarball bütünlüğü — SHASUMS.sha256 ile birebir.
  const files = (await readdir(OUT)).filter((f) => f.endsWith('.tgz'));
  const tarballName = files[0];
  if (!tarballName) die('dist-standalone içinde *.tgz yok');
  const shasumsRaw = await readFile(join(OUT, 'SHASUMS.sha256'), 'utf8');
  const expected = shasumsRaw.split(/\s+/)[0];
  const actual = createHash('sha256').update(await readFile(join(OUT, tarballName))).digest('hex');
  if (expected !== actual) {
    die(`tarball SHA-256 uyuşmuyor (SHASUMS: ${expected}, hesaplanan: ${actual})`);
  }
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) die('SHASUMS.sha256 bozuk');

  process.stdout.write(`✓ jam: tarball ${tarballName} SHA-256 eşleşti (${expected.slice(0, 16)}…)\n`);

  // Yayın hedefi: sağlam tar ile üretilmiş tarball'in KENDİSİDİR. `npm pack` /
  // `npm publish <dir>` elle yerleştirilen `node_modules`'u bundle etmediği
  // için (Commit 5'te ölçüldü) kök dizini pack'lemek tekrar paketsiz tarball
  // üretir. github scoped akışında kaynak tarball'a dokunulmaz — kopyada ad
  // scoped yapılır ve tar ile yeniden paketlenir.
  let targetTarball = join(OUT, tarballName);
  const publishName = registry === 'github' ? `${scope}/mcpdev` : 'mcpdev';
  if (registry === 'github') {
    const staging = await mkdtemp(join(tmpdir(), 'mcpdev-publish-'));
    const copy = join(staging, 'package');
    await cp(PKG_DIR, copy, { recursive: true });
    const stagedPkg = JSON.parse(await readFile(join(copy, 'package.json'), 'utf8'));
    stagedPkg.name = publishName;
    await writeFile(join(copy, 'package.json'), JSON.stringify(stagedPkg, null, 2) + '\n');
    targetTarball = join(staging, `${publishName.replace('/', '-')}-${pkg.version}.tgz`);
    execFileSync('tar', ['-czf', targetTarball, '-C', staging, 'package'], { stdio: 'inherit' });
  }

  // Bundle kanıtı — yayınlanacak tarball'in KENDİ İÇERİĞİ: `tar -t` listesinde
  // gömülü @mcpdev paketleri olmalıdır.
  const listing = execFileSync('tar', ['-tzf', targetTarball], { encoding: 'utf8' });
  const bundled = listing.split('\n').filter((l) => l.includes(`${BUNDLED_VENDOR}/`));
  if (bundled.length === 0) {
    die('yayınlanacak tarball bundle içermiyor — bundled @mcpdev paketleri yayına gitmez');
  }
  process.stdout.write(`✓ bundle kanıtı: ${bundled.length} ${BUNDLED_VENDOR}/ dosyası tarball'da\n`);
  if (registry === 'github') {
    const d = createHash('sha256').update(await readFile(targetTarball)).digest('hex');
    process.stdout.write(`  scoped tarball SHA-256: ${d}\n`);
  }

  const registryArgs =
    registry === 'github' ? ['--registry', 'https://npm.pkg.github.com'] : [];

  const publishCmd = [
    'publish',
    targetTarball,
    '--tag', 'next',
    ...(dryRun ? ['--dry-run'] : []),
    ...registryArgs,
  ];
  execFileSync(NPM, publishCmd, { ...EXEC_OPTS, stdio: 'inherit' });

  if (dryRun) {
    process.stdout.write(`✓ dry-run: ${publishName}@${pkg.version} hazır (registry: ${registry})\n`);
    return;
  }

  const home =
    registry === 'github'
      ? `https://github.com/${scope}/mcpdev/pkgs/npm/mcpdev`
      : `https://www.npmjs.com/package/${publishName}`;
  process.stdout.write(`✓ yayınlandı: ${publishName}@${pkg.version}\n`);
  process.stdout.write(`  ${home}\n`);
}

main().catch((err) => {
  process.stderr.write(`publish-standalone: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
