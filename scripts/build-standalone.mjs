#!/usr/bin/env node
// Build standalone distribution (Phase 2 — tek npm paketi).
//
// Workspace build çıktılarını + gömülü varlıkları (bridge JAR, compatibility
// profilleri, fixture manifest, dahili @mcpdev paketleri) tek bir `mcpdev`
// npm paketine toplar ve tarball üretir:
//
//   dist-standalone/mcpdev-<version>.tgz
//   dist-standalone/mcpdev-<version>.tgz.sha256   (tarball SHA-256 yan dosyası)
//   dist-standalone/SHASUMS.sha256                (tarball tekil doğrulama listesi)
//
// Dahili paketler node_modules'a gömülür ve `bundleDependencies` ile tarball'a
// taşınır (registry yayını yoktur); harici bağımlılıklar (yaml, zod,
// @modelcontextprotocol/server) consumer'da `npm install <tarball>` ile
// registry'den kurulur. Tarball, npm pack'in elle yerleştirilen node_modules'u
// dışlaması nedeniyle sağlam `tar` aracıyla üretilir.
//
// Ön koşul: `pnpm run build` çalışmış ve bridge JAR derlenmiş olmalı.

import { cp, mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-standalone');
/** npm paket kökü — tarball bu dizinin `package` sanal kökü üzerinden üretilir. */
const PKG = join(OUT, 'package');
const DIST = join(PKG, 'dist');

/** Harici runtime bağımlılıkları — standalone package.json `dependencies`. */
const EXTERNAL_DEPENDENCIES = {
  '@modelcontextprotocol/server': '2.0.0',
  yaml: '2.8.1',
  zod: '4.4.3',
};

const VENDOR = '@mcpdev';

const INTERNAL_PACKAGES = [
  { name: '@mcpdev/contracts', dir: 'contracts' },
  { name: '@mcpdev/evidence-model', dir: 'evidence-model' },
  { name: '@mcpdev/generated-types', dir: 'generated-types' },
];

const ENTRY_APPS = [
  { from: 'apps/cli/dist', to: 'cli' },
  { from: 'apps/run-supervisor/dist', to: 'supervisor' },
  { from: 'apps/mcp-server/dist', to: 'mcp-server' },
];

function die(message) {
  process.stderr.write(`build-standalone: ${message}\n`);
  process.exit(1);
}

async function mustExist(path, label) {
  try {
    const s = await stat(path);
    if (!s.isDirectory() && !s.isFile()) die(`${label} beklenen türde değil: ${path}`);
  } catch {
    die(`${label} bulunamadı: ${path} (önce \`pnpm run build\` ve bridge JAR derlemesi gerekir)`);
  }
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(PKG, 'node_modules', VENDOR), { recursive: true });
  await mkdir(join(DIST, 'content', 'compatibility'), { recursive: true });
  await mkdir(join(DIST, 'content', 'fixtures', 'manifests'), { recursive: true });
  await mkdir(join(DIST, 'content', 'bridge'), { recursive: true });

  // Ön koşullar.
  for (const { from } of ENTRY_APPS) {
    await mustExist(join(ROOT, from), `Uygulama build çıktısı`);
  }
  await mustExist(join(ROOT, 'packages', 'contracts', 'dist'), 'contracts dist');
  await mustExist(join(ROOT, 'packages', 'generated-types', 'dist'), 'generated-types dist');
  await mustExist(join(ROOT, 'packages', 'evidence-model', 'dist'), 'evidence-model dist');

  // Bridge JAR — sabit isimle gömülür (self-location için deterministik yol).
  const libsDir = join(ROOT, 'bridge', 'paper', 'build', 'libs');
  const jarFiles = (await readdir(libsDir).catch(() => [])).filter(
    (f) => f.endsWith('.jar') && !f.endsWith('-sources.jar'),
  );
  const bridgeJar = jarFiles[0];
  if (!bridgeJar) die(`bridge/paper/build/libs içinde JAR bulunamadı (Gradle build gerekir)`);
  await cp(join(libsDir, bridgeJar), join(DIST, 'content', 'bridge', 'mcpdev-bridge.jar'));

  // Uygulama dist'leri.
  for (const { from, to } of ENTRY_APPS) {
    await cp(join(ROOT, from), join(DIST, to), { recursive: true });
  }

  // Compatibility profilleri + fixture manifest (canonical kaynak, sürüm pinli).
  // NOT: filter dizinleri atlamamalı — yalnızca .yaml dışı dosyaları eler.
  await cp(join(ROOT, 'compatibility'), join(DIST, 'content', 'compatibility'), {
    recursive: true,
    filter: async (src) => {
      const s = await stat(src);
      return s.isDirectory() || src.endsWith('.yaml');
    },
  });
  await cp(
    join(ROOT, 'fixtures', 'manifests'),
    join(DIST, 'content', 'fixtures', 'manifests'),
    { recursive: true },
  );

  // Dahili @mcpdev paketleri — paket kökündeki node_modules'a gömülür ve
  // `bundleDependencies` ile tarball'a taşınır (registry yayını yoktur).
  // NOT: `file:` bağımlılıklarından kaçınılır — npm arborist, bundle içindeki
  // file: hedeflerini çözerken (#resolveLinks) crash verebilir (npm 11.x).
  // Bundled kopyaların kendi dependencies/devDependencies alanları boşaltılır:
  // npm bundled dep'lerin bağımlılıklarını kurmaz; boş bırakmak registry
  // çözümlemesi yapılmamasını garanti eder.
  for (const { dir } of INTERNAL_PACKAGES) {
    const src = join(ROOT, 'packages', dir);
    const bundled = join(PKG, 'node_modules', VENDOR, dir);
    await mkdir(bundled, { recursive: true });
    await cp(join(src, 'package.json'), join(bundled, 'package.json'));
    await cp(join(src, 'dist'), join(bundled, 'dist'), { recursive: true });
    const pkg = JSON.parse(await readFile(join(bundled, 'package.json'), 'utf8'));
    delete pkg.dependencies;
    delete pkg.devDependencies;
    pkg.private = false;
    await writeFile(join(bundled, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  }

  // Standalone package.json — tek bin girişi `mcpdev`.
  const rootPkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const standalonePkg = {
    name: 'mcpdev',
    version: rootPkg.version,
    description: rootPkg.description,
    license: rootPkg.license,
    type: 'module',
    engines: { node: '>=22' },
    bin: { mcpdev: './dist/cli/src/index.js' },
    files: ['dist', 'STANDALONE'],
    dependencies: EXTERNAL_DEPENDENCIES,
    bundleDependencies: INTERNAL_PACKAGES.map(({ name }) => name),
  };
  await writeFile(join(PKG, 'package.json'), JSON.stringify(standalonePkg, null, 2) + '\n');

  // Marker: self-location (apps/cli/src/layout.ts) standalone düzeni tanır.
  await writeFile(join(PKG, 'STANDALONE'), `# mcpdev standalone package (v${rootPkg.version})\n`);

  // Tarball — node_modules dahil edilmek zorunda olduğundan npm pack yerine
  // sağlam `tar` kullanılır (npm pack, elle yerleştirilen node_modules'u
  // bundle etmez). `package` sanal kökü npm tarball konvansiyonunu karşılar.
  const version = rootPkg.version;
  const tarball = join(OUT, `mcpdev-${version}.tgz`);
  const tarBin = 'tar';
  execFileSync(tarBin, ['-czf', tarball, '-C', OUT, 'package'], { stdio: 'inherit' });

  // Tarball SHA-256 — doğrulama için yan dosya + SHASUMS listesi üretilir.
  const digest = createHash('sha256').update(await readFile(tarball)).digest('hex');
  const tarballName = `mcpdev-${version}.tgz`;
  await writeFile(join(OUT, `${tarballName}.sha256`), `${digest}  ${tarballName}\n`);
  await writeFile(join(OUT, 'SHASUMS.sha256'), `${digest}  ${tarballName}\n`);

  process.stdout.write(`✓ standalone tarball: ${tarball}\n`);
  process.stdout.write(`  sha256: ${digest}\n`);
  process.stdout.write(`  (kullanım: npm install -g ${tarball}  |  npm install ${tarball})\n`);
}

main().catch((err) => {
  process.stderr.write(`build-standalone: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
