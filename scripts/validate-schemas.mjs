#!/usr/bin/env node
// DOC-GATE-03 / DOC-GATE-04 — Şema derlenebilirliği ve kayıtların şemaya uygunluğu.
//
//   1. Tüm JSON Schema dosyaları Ajv ile derlenebilmeli
//   2. Her capability kaydı capability.schema.json'a uymalı
//   3. Her error catalog dosyası error-catalog-file.schema.json'a uymalı
//   4. config.example.yaml config.schema.json'a uymalı
//   5. Orphan şema yok: contracts/ altındaki her şema ya bir başkası tarafından
//      $ref ile kullanılmalı ya da bir capability kaydında contracts.* olarak
//      anılmalı

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { PATHS, ROOT, readJson, readYaml, loadCapabilities, fail, ok } from './lib/registry.mjs';

const errors = [];

function collectSchemas(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSchemas(full, out);
    else if (entry.endsWith('.schema.json')) out.push(full);
  }
  return out;
}

const schemaFiles = [
  ...collectSchemas(PATHS.contracts),
  PATHS.capabilitySchema,
  PATHS.errorSchema,
  PATHS.errorFileSchema,
  PATHS.configSchema,
].filter((f) => existsSync(f));

const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
addFormats(ajv);

// 1 — hepsini BİR KEZ kaydet, sonra derle.
//
// Ajv, addSchema çağrısında şemanın $id'sini zaten kaydeder; ikinci bir anahtarla
// tekrar eklemek "already exists" hatası verir. Göreli $ref'ler ($ref:
// "tool-error.schema.json") zaten $id URI'sine göre çözüldüğü için ek bir
// dosya-adı anahtarına ihtiyaç yoktur.
const schemaIds = new Map();
for (const file of schemaFiles) {
  try {
    const schema = readJson(file);
    const id = schema.$id ?? relative(ROOT, file);
    if (schemaIds.has(id)) {
      errors.push(`Duplicate $id "${id}": ${relative(ROOT, file)} ve ${schemaIds.get(id)}`);
      continue;
    }
    schemaIds.set(id, relative(ROOT, file));
    ajv.addSchema(schema, id);
  } catch (err) {
    errors.push(`${relative(ROOT, file)}: ${err.message}`);
  }
}

/** Kayıtlı şemayı derler; addSchema ile çakışmamak için getSchema kullanır. */
function compile(file) {
  try {
    const schema = readJson(file);
    const id = schema.$id ?? relative(ROOT, file);
    const validate = ajv.getSchema(id);
    if (!validate) {
      errors.push(`${relative(ROOT, file)} derlenemedi: şema kayıtlı değil ($id: ${id})`);
      return null;
    }
    return validate;
  } catch (err) {
    errors.push(`${relative(ROOT, file)} derlenemedi: ${err.message}`);
    return null;
  }
}

// 2
const validateCapability = compile(PATHS.capabilitySchema);
const caps = loadCapabilities();
if (validateCapability) {
  for (const { file, record } of caps) {
    if (!validateCapability(record)) {
      for (const e of validateCapability.errors ?? []) {
        errors.push(`${relative(ROOT, file)}${e.instancePath}: ${e.message}`);
      }
    }
  }
}

// 3
const validateErrorFile = compile(PATHS.errorFileSchema);
if (validateErrorFile && existsSync(PATHS.errors)) {
  for (const f of readdirSync(PATHS.errors).filter((x) => x.endsWith('.yaml'))) {
    const full = join(PATHS.errors, f);
    if (!validateErrorFile(readYaml(full))) {
      for (const e of validateErrorFile.errors ?? []) {
        errors.push(`${relative(ROOT, full)}${e.instancePath}: ${e.message}`);
      }
    }
  }
}

// 4
const validateConfig = compile(PATHS.configSchema);
const exampleConfig = join(ROOT, 'packages', 'config-schema', 'config.example.yaml');
if (validateConfig && existsSync(exampleConfig)) {
  if (!validateConfig(readYaml(exampleConfig))) {
    for (const e of validateConfig.errors ?? []) {
      errors.push(`config.example.yaml${e.instancePath}: ${e.message}`);
    }
  }
}

// 5 — orphan şema tespiti
const referenced = new Set();
for (const file of schemaFiles) {
  const raw = readFileSync(file, 'utf8');
  for (const m of raw.matchAll(/"\$ref"\s*:\s*"([^"#][^"]*)"/g)) {
    referenced.add(basename(m[1].split('#')[0]));
  }
}
for (const { record } of caps) {
  for (const p of [record.contracts?.input, record.contracts?.output]) {
    if (p) referenced.add(basename(p));
  }
}

const ROOT_SCHEMAS = new Set([
  'tool-result.schema.json',
  'scenario.schema.json',
  'bridge-request.schema.json',
  'bridge-response.schema.json',
  'bridge-event.schema.json',
  'capability.schema.json',
  'error-catalog-file.schema.json',
  'config.schema.json',
]);

for (const file of collectSchemas(PATHS.contracts)) {
  const name = basename(file);
  if (!ROOT_SCHEMAS.has(name) && !referenced.has(name)) {
    errors.push(`Orphan şema (hiçbir yerden referans verilmiyor): ${relative(ROOT, file)}`);
  }
}

if (errors.length) fail(errors);
ok(`${schemaFiles.length} şema derlendi, ${caps.length} capability kaydı doğrulandı.`);
