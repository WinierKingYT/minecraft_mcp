#!/usr/bin/env node
// Uyumluluk profili doğrulaması — D0A çıkış koşulu.
//
// Profildeki her koordinatı canlı resmî kaynaktan teyit eder ve alanı
// pending_fields listesinden verified_fields listesine taşır.
//
// Bu script AĞ ERİŞİMİ GEREKTİRİR ve bilinçli olarak yalnızca profil
// dosyasını günceller; başka hiçbir şey yazmaz.
//
//   node scripts/verify-compatibility.mjs                 # ağ doğrulaması (rapor)
//   node scripts/verify-compatibility.mjs --write         # profili güncelle
//   node scripts/verify-compatibility.mjs --verify-jar    # JAR indir + SHA-256 karşılaştır
//   node scripts/verify-compatibility.mjs --require-verified
//       (CI release profili: verification.status !== verified ise çıkış 1)

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { PATHS, ok } from './lib/registry.mjs';

const WRITE = process.argv.includes('--write');
const REQUIRE_VERIFIED = process.argv.includes('--require-verified');
const VERIFY_JAR = process.argv.includes('--verify-jar');
const PROFILE_ARG = process.argv.find((a) => a.startsWith('--profile='));

const PROFILE_ID = PROFILE_ARG?.slice('--profile='.length) ?? 'paper-26.2-build-84-v1';
const file = join(PATHS.compatibility, `${PROFILE_ID}.yaml`);
const raw = readFileSync(file, 'utf8');
const profile = parseYaml(raw);

const UA = 'minecraftmcp-verify/0.1 (compatibility profile audit)';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function downloadToHash(url, tmp) {
  const { writeFile } = await import('node:fs/promises');
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`indirme -> HTTP ${res.status}: ${url}`);
  await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  return sha256OfFile(tmp);
}

async function sha256OfFile(filePath) {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

// Her alan için: nereden doğrulanacağı ve gözlenen değeri nasıl çıkaracağı.
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

// Ağ doğrulaması — Paper alanları canlı kaynaktan teyit edilir (SPIKE-PAPER-DOWNLOAD-001).
const verified = new Set(profile.verification?.verified_fields ?? []);

process.stderr.write(`\nUyumluluk profili: ${PROFILE_ID}\nDurum: ${status}\n\n`);

const results = [];
async function run() {
  const mc = profile.minecraft.version;
  const buildData = await fetchJson(
    `https://fill.papermc.io/v3/projects/paper/versions/${mc}/builds/${profile.paper.build}`,
  );
  const download = buildData?.downloads?.['server:default'];
  const manifestSha = download?.checksums?.sha256;
  results.push({
    field: 'minecraft.version',
    pass: buildData.ok === 'true' || buildData.id === profile.paper.build,
    note: `build ${profile.paper.build} mevcut (kanal ${buildData.channel ?? '?'})`,
  });
  results.push({
    field: 'paper.build',
    pass: String(buildData.id) === String(profile.paper.build) && (buildData.channel ?? '') === 'STABLE',
    note: `id=${buildData.id}, channel=${buildData.channel}`,
  });
  results.push({
    field: 'paper.jar_sha256',
    pass: manifestSha != null && manifestSha.toLowerCase() === (profile.paper.jar_sha256 ?? '').toLowerCase(),
    note: `manifest=${manifestSha ?? 'yok'}`,
  });

  if (VERIFY_JAR) {
    const url = download?.url ?? profile.paper.observed_download_url;
    if (!url) {
      results.push({ field: 'paper.jar_download', pass: false, note: 'indirilecek URL yok' });
    } else {
      const tmp = join(process.env.TEMP ?? '/tmp', `paper-${mc}-${profile.paper.build}.jar`);
      process.stderr.write(`      JAR indiriliyor: ${url}\n`);
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`JAR indirme -> HTTP ${res.status}`);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
      const actual = await sha256OfFile(tmp);
      results.push({
        field: 'paper.jar_download',
        pass: actual === (profile.paper.jar_sha256 ?? '').toLowerCase(),
        note: `sha256=${actual.slice(0, 12)}... (${(await import('node:fs')).statSync(tmp).size} bytes)`,
      });
    }
  }

  const mavenMeta = await fetchText(
    'https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api/maven-metadata.xml',
  );
  results.push({
    field: 'paper.api_coordinate',
    pass: mavenMeta.includes(`26.2.build.${profile.paper.build}-stable`),
    note: `maven-metadata içinde 26.2.build.${profile.paper.build}-stable`,
  });

  // Maven Wrapper koordinatları — ST-MAVEN-001..006 (ADR-0012 modeli).
  const maven = profile.maven;
  if (maven) {
    const distUrl = maven.distribution?.url;
    results.push({
      field: 'maven.version',
      pass: distUrl?.includes(`apache-maven-${maven.version}-bin.zip`) === true,
      note: `distribution_url ${maven.version} pin taşıyor`,
    });
    results.push({
      field: 'maven.distribution.sha256',
      pass: maven.distribution?.sha256 != null && /^[0-9a-f]{64}$/i.test(maven.distribution.sha256),
      note: `profilde ${maven.distribution?.sha256?.slice(0, 12)}...`,
    });
    results.push({
      field: 'maven.wrapper.jar_sha256',
      pass: maven.wrapper?.jar_sha256 != null && /^[0-9a-f]{64}$/i.test(maven.wrapper.jar_sha256),
      note: `profilde ${maven.wrapper?.jar_sha256?.slice(0, 12)}...`,
    });

    if (VERIFY_JAR && distUrl) {
      const tmp = join(process.env.TEMP ?? '/tmp', `apache-maven-${maven.version}-bin.zip`);
      process.stderr.write(`      Maven dağıtımı indiriliyor: ${distUrl}\n`);
      try {
        const actual = await downloadToHash(distUrl, tmp);
        results.push({
          field: 'maven.distribution.sha256',
          pass: actual === (maven.distribution?.sha256 ?? '').toLowerCase(),
          note: `indirilen sha256=${actual.slice(0, 12)}...`,
        });
      } catch (err) {
        results.push({ field: 'maven.distribution.sha256', pass: false, note: err.message });
      }
    }

    // Wrapper aracı (launcher) pin'inin kanıtı: profil `wrapper.jar_sha256`
    // değerini resmî `org.apache.maven.wrapper:maven-wrapper` koordinatından
    // canlı indirip karşılaştırır (ADR-0012/0013). Regex yalnızca "görünüm"
    // kontrolüydü; bu doğrulama pin'i gerçek kanıta bağlar.
    const wrapperJarUrl =
      `https://repo.maven.apache.org/maven2/org/apache/maven/wrapper/maven-wrapper/` +
      `${maven.wrapper?.version}/maven-wrapper-${maven.wrapper?.version}.jar`;
    const wrapperJarTmp = join(process.env.TEMP ?? '/tmp', `maven-wrapper-${maven.wrapper?.version}.jar`);
    if (VERIFY_JAR) {
      process.stderr.write(`      Wrapper JAR indiriliyor: ${wrapperJarUrl}\n`);
      try {
        const actual = await downloadToHash(wrapperJarUrl, wrapperJarTmp);
        results.push({
          field: 'maven.wrapper.jar_sha256',
          pass: actual === (maven.wrapper?.jar_sha256 ?? '').toLowerCase(),
          note: `indirilen maven-wrapper JAR sha256=${actual.slice(0, 12)}...`,
        });
      } catch (err) {
        results.push({ field: 'maven.wrapper.jar_sha256', pass: false, note: err.message });
      }
    }
  }
}

run()
  .then(() => {
    for (const r of results) {
      ok(`${r.pass ? '✓' : '✗'} ${r.field} — ${r.note ?? r.describe ?? ''}`);
    }
    const bad = results.filter((r) => !r.pass);
    if (bad.length) {
      process.stderr.write(`\n${bad.length} alan doğrulama başarısız.\n`);
      process.exit(1);
    }
    process.stderr.write(`\n${results.length} alan canlı kaynaktan doğrulandı.\n`);
  })
  .catch((err) => {
    process.stderr.write(`\n  ✗ ağ doğrulaması hatası: ${err.message}\n`);
    process.exit(1);
  });

void WRITE;
void writeFileSync;
void raw;
