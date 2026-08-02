#!/usr/bin/env node
// DOC-GATE-04 — Registry bütünlüğü.
//
// Denetlenen kurallar:
//   1. Duplicate capability id yok
//   2. Duplicate error code yok
//   3. Dosya adı capability id ile eşleşiyor
//   4. errors/<owner>.yaml içindeki her kaydın owner'ı dosya adıyla eşleşiyor
//   5. risk.level metadata'dan türetilen değerle eşleşiyor
//   6. R3/R4 capability'lerinde developer_tool null (ADR-0007)
//   7. mutation etkili her capability requires_idempotency taşıyor
//   8. Aynı tool adı iki capability'de kullanılmıyor
//   9. Capability errors listesindeki her kod catalog'da mevcut
//  10. Her profil tool'u bir capability'ye bağlı
//  11. Her capability en az bir contract testi taşıyor
//  12. MUTATION_UNKNOWN_OUTCOME retryable: false

import {
  loadCapabilities,
  loadErrors,
  loadProfiles,
  deriveRiskLevel,
  toolNameFor,
  fileNameForCapabilityId,
  fail,
  ok,
} from './lib/registry.mjs';
import { basename } from 'node:path';

const errors = [];
const caps = loadCapabilities();
const errorRecords = loadErrors();
const profiles = loadProfiles();

if (caps.length === 0) errors.push('Hiç capability kaydı bulunamadı.');
if (errorRecords.length === 0) errors.push('Hiç error kaydı bulunamadı.');

// 1 + 3
const seenIds = new Map();
for (const { file, name, record } of caps) {
  const id = record?.id;
  if (!id) {
    errors.push(`${basename(file)}: id alanı yok.`);
    continue;
  }
  if (seenIds.has(id)) {
    errors.push(`Duplicate capability id "${id}": ${basename(file)} ve ${basename(seenIds.get(id))}`);
  }
  seenIds.set(id, file);

  const expectedName = fileNameForCapabilityId(id);
  if (name !== expectedName) {
    errors.push(`${basename(file)}: dosya adı "${expectedName}.yaml" olmalı (id: ${id}).`);
  }
}

// 3b — iki farklı id aynı dosya adına düşemez (örn. a.b_c ve a_b.c).
const byFileName = new Map();
for (const { record } of caps) {
  if (!record?.id) continue;
  const derived = fileNameForCapabilityId(record.id);
  const prev = byFileName.get(derived);
  if (prev && prev !== record.id) {
    errors.push(`Dosya adı çakışması "${derived}.yaml": ${prev} ve ${record.id}`);
  }
  byFileName.set(derived, record.id);
}

// 2 + 4
const seenCodes = new Map();
for (const { file, owner, record } of errorRecords) {
  const code = record?.code;
  if (!code) {
    errors.push(`${basename(file)}: code alanı olmayan kayıt.`);
    continue;
  }
  if (seenCodes.has(code)) {
    errors.push(`Duplicate error code "${code}": ${basename(file)} ve ${basename(seenCodes.get(code))}`);
  }
  seenCodes.set(code, file);

  if (record.owner !== owner) {
    errors.push(`${code}: owner "${record.owner}" dosya adı "${owner}" ile eşleşmiyor.`);
  }

  // 12
  if (code === 'MUTATION_UNKNOWN_OUTCOME' && record.tool_result?.retryable !== false) {
    errors.push('MUTATION_UNKNOWN_OUTCOME retryable: false olmak zorundadır (kör retry yasağı).');
  }
}

// 5, 6, 7, 9, 11
for (const { file, record } of caps) {
  const id = record?.id ?? basename(file);
  const risk = record?.risk;
  if (!risk) {
    errors.push(`${id}: risk bloğu yok.`);
    continue;
  }

  const derived = deriveRiskLevel(risk);
  if (derived === null) {
    errors.push(`${id}: risk metadata kombinasyonu sınıflandırılamıyor (effect=${risk.effect}, scope=${risk.scope}, reversibility=${risk.reversibility}).`);
  } else if (derived !== risk.level) {
    errors.push(`${id}: risk.level "${risk.level}" fakat metadata'dan türetilen "${derived}".`);
  }

  if ((risk.level === 'R3' || risk.level === 'R4') && record.exposure?.developer_tool) {
    errors.push(`${id}: ${risk.level} capability developer_tool taşıyamaz (ADR-0007) — "${record.exposure.developer_tool}".`);
  }

  if (risk.effect === 'mutation' && record.limits?.requires_idempotency !== true) {
    errors.push(`${id}: mutation etkili capability limits.requires_idempotency: true taşımak zorundadır.`);
  }

  for (const code of record.errors ?? []) {
    if (!seenCodes.has(code)) {
      errors.push(`${id}: error kodu "${code}" catalog'da tanımlı değil.`);
    }
  }

  if (!(record.tests?.contract?.length > 0)) {
    errors.push(`${id}: en az bir contract testi tanımlanmalı.`);
  }
}

// 8 + 10
const toolOwners = new Map();
for (const profileName of Object.keys(profiles?.profiles ?? {})) {
  const declared = profiles.profiles[profileName].tools ?? [];
  const bound = new Set();

  for (const { record } of caps) {
    const tool = toolNameFor(record, profileName);
    if (!tool) continue;
    bound.add(tool);

    const prev = toolOwners.get(tool);
    if (prev && prev !== record.id) {
      errors.push(`Tool adı "${tool}" iki capability tarafından kullanılıyor: ${prev} ve ${record.id}.`);
    }
    toolOwners.set(tool, record.id);
  }

  for (const tool of declared) {
    if (!bound.has(tool)) {
      errors.push(`Profil "${profileName}": "${tool}" hiçbir capability kaydına bağlı değil.`);
    }
  }
  for (const tool of bound) {
    if (!declared.includes(tool)) {
      errors.push(`Profil "${profileName}": capability "${tool}" tool'unu açıyor fakat profiles.yaml listesinde yok.`);
    }
  }

  const sorted = [...declared].sort();
  if (declared.length !== new Set(declared).size) {
    errors.push(`Profil "${profileName}": tool listesinde duplicate var.`);
  }
  void sorted; // sıra normatiftir; alfabetik olması gerekmez, sabit olması gerekir
}

if (errors.length) fail(errors);

ok(`${caps.length} capability, ${errorRecords.length} error kodu, ${Object.keys(profiles.profiles).length} profil doğrulandı.`);
