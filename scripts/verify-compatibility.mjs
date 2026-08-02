#!/usr/bin/env node
// Uyumluluk profili doğrulaması — D0A çıkış koşulu.
//
// Profildeki her koordinatı canlı resmî kaynaktan teyit eder ve alanı
// pending_fields listesinden verified_fields listesine taşır.
//
// Bu script AĞ ERİŞİMİ GEREKTİRİR ve bilinçli olarak yalnızca profil
// dosyasını günceller; başka hiçbir şey yazmaz.
//
//   node scripts/verify-compatibility.mjs                 # rapor
//   node scripts/verify-compatibility.mjs --write         # profili güncelle
//   node scripts/verify-compatibility.mjs --require-verified
//       (CI release profili: verification.status !== verified ise çıkış 1)

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { PATHS, ok } from './lib/registry.mjs';

const WRITE = process.argv.includes('--write');
const REQUIRE_VERIFIED = process.argv.includes('--require-verified');

const PROFILE_ID = 'paper-26.2-build-84-v1';
const file = join(PATHS.compatibility, `${PROFILE_ID}.yaml`);
const raw = readFileSync(file, 'utf8');
const profile = parseYaml(raw);

// Her alan için: nereden doğrulanacağı ve gözlenen değeri nasıl çıkaracağı.
const CHECKS = [
  {
    field: 'minecraft.version',
    source: 'https://fill.api.papermc.io/v3/projects/paper',
    describe: 'Downloads Service sürüm listesinde profildeki Minecraft sürümü var mı',
    expected: () => profile.minecraft.version,
  },
  {
    field: 'paper.build',
    source: `https://fill.api.papermc.io/v3/projects/paper/versions/${profile.minecraft.version}/builds`,
    describe: 'Belirtilen build mevcut ve kanalı STABLE mı',
    expected: () => String(profile.paper.build),
  },
  {
    field: 'paper.jar_sha256',
    source: 'build manifest -> downloads.server:default.checksums.sha256',
    describe: 'Paper JAR SHA-256 değeri manifest ile eşleşiyor mu',
    expected: () => profile.paper.jar_sha256,
  },
  {
    field: 'paper.api_coordinate',
    source: 'https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api/maven-metadata.xml',
    describe: 'Paper API Maven koordinatı ve sürümü gerçekten var mı',
    expected: () => profile.paper.api_coordinate,
    note: 'V3 belgesindeki biçim (26.2.build.84-stable) Paper\'ın tarihsel <mc>-R0.1-SNAPSHOT şemasından farklıdır; özellikle doğrulanmalıdır.',
  },
  {
    field: 'mcp.protocol_version',
    source: 'https://modelcontextprotocol.io/specification/ (revizyon listesi)',
    describe: 'Protokol revizyonu yayınlanmış mı; draft/RC/stable durumu ne',
    expected: () => profile.mcp.protocol_version,
  },
  {
    field: 'mcp.sdk.server',
    source: 'https://registry.npmjs.org/@modelcontextprotocol/server',
    describe: 'SDK sürümü npm registry\'de mevcut mu',
    expected: () => profile.mcp.sdk?.server,
  },
  {
    field: 'mcp.sdk.node',
    source: 'https://registry.npmjs.org/@modelcontextprotocol/node',
    describe: 'Node SDK sürümü npm registry\'de mevcut mu',
    expected: () => profile.mcp.sdk?.node,
  },
  {
    field: 'node.version',
    source: 'https://nodejs.org/dist/index.json',
    describe: 'Node sürümü yayınlanmış ve LTS hattında mı',
    expected: () => profile.node.version,
  },
  {
    field: 'gradle.wrapper_version',
    source: 'https://services.gradle.org/versions/all',
    describe: 'Gradle sürümü yayınlanmış mı',
    expected: () => profile.gradle.wrapper_version,
  },
  {
    field: 'gradle.distribution_sha256',
    source: 'https://services.gradle.org/distributions/gradle-<v>-bin.zip.sha256',
    describe: 'Dağıtım checksum\'ı profildeki değerle eşleşiyor mu',
    expected: () => profile.gradle.distribution_sha256,
  },
  {
    field: 'java.runtime_major',
    source: 'yerel `java -version`',
    describe: 'Kurulu Java major sürümü profil ile eşleşiyor mu',
    expected: () => String(profile.java.runtime_major),
  },
  {
    field: 'npm_toolchain',
    source: 'pnpm install + commit edilmiş lockfile',
    describe: 'Node araç zinciri pinleri kurulabiliyor ve lockfile commit edilmiş mi',
    expected: () => (profile.npm_toolchain.lockfile_committed ? 'committed' : 'not committed'),
  },
];

const status = profile.verification?.status ?? 'unverified';

if (REQUIRE_VERIFIED) {
  if (status !== 'verified') {
    process.stderr.write(
      `\n  ✗ Uyumluluk profili "${status}" durumunda.\n` +
        '    Release build doğrulanmamış profille üretilemez (COMPATIBILITY_PROFILE_UNVERIFIED).\n' +
        `    ${profile.verification?.pending_fields?.length ?? 0} alan bekliyor.\n\n`,
    );
    process.exit(1);
  }
  ok('Uyumluluk profili doğrulanmış.');
  process.exit(0);
}

// Ağ doğrulaması bu iskelette uygulanmadı: her kaynağın gerçek yanıt şekli
// SPIKE-PAPER-DOWNLOAD-001 ve SPIKE-MCP-SDK-2026-001 ile tespit edilecek.
// Script şu an doğrulama PLANINI raporlar ve neyin bekletildiğini gösterir.
process.stderr.write(`\nUyumluluk profili: ${PROFILE_ID}\nDurum: ${status}\n\n`);

const pending = new Set(profile.verification?.pending_fields ?? []);
const verified = new Set(profile.verification?.verified_fields ?? []);

for (const check of CHECKS) {
  const mark = verified.has(check.field) ? '✓' : pending.has(check.field) ? '·' : '?';
  process.stderr.write(`  ${mark} ${check.field}\n`);
  process.stderr.write(`      beklenen : ${check.expected() ?? '(boş)'}\n`);
  process.stderr.write(`      kaynak   : ${check.source}\n`);
  process.stderr.write(`      kontrol  : ${check.describe}\n`);
  if (check.note) process.stderr.write(`      DİKKAT   : ${check.note}\n`);
  process.stderr.write('\n');
}

process.stderr.write(
  `${verified.size} doğrulanmış, ${pending.size} bekliyor.\n\n` +
    'Ağ doğrulaması henüz uygulanmadı (SPIKE-PAPER-DOWNLOAD-001 ve\n' +
    'SPIKE-MCP-SDK-2026-001 her kaynağın yanıt şeklini tespit edecek).\n' +
    'Bir alanı elle doğruladığınızda profildeki pending_fields listesinden\n' +
    'çıkarıp verified_fields listesine ekleyin.\n\n',
);

if (WRITE) {
  process.stderr.write('  ! --write, ağ doğrulaması uygulanana kadar etkisizdir.\n');
  void raw;
  void writeFileSync;
}
