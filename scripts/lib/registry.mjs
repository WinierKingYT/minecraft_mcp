// Capability registry, error catalog ve compatibility profile yükleyicisi.
// Tüm doğrulama ve codegen script'leri bu modülü kullanır; ikinci bir
// okuma yolu yoktur (tek gerçek kaynak ilkesi).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const PATHS = {
  capabilities: join(ROOT, 'packages', 'capability-registry', 'capabilities'),
  capabilitySchema: join(ROOT, 'packages', 'capability-registry', 'schema', 'capability.schema.json'),
  profiles: join(ROOT, 'packages', 'capability-registry', 'profiles.yaml'),
  errors: join(ROOT, 'packages', 'error-catalog', 'errors'),
  errorSchema: join(ROOT, 'packages', 'error-catalog', 'schema', 'error.schema.json'),
  errorFileSchema: join(ROOT, 'packages', 'error-catalog', 'schema', 'error-catalog-file.schema.json'),
  contracts: join(ROOT, 'packages', 'contracts', 'schemas'),
  configSchema: join(ROOT, 'packages', 'config-schema', 'schema', 'config.schema.json'),
  generated: join(ROOT, 'packages', 'generated-types', 'src'),
  compatibility: join(ROOT, 'compatibility'),
  docs: join(ROOT, 'docs'),
};

export function readYaml(file) {
  return parseYaml(readFileSync(file, 'utf8'));
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** capabilities/*.yaml -> [{ file, name, record }] */
export function loadCapabilities() {
  if (!existsSync(PATHS.capabilities)) return [];
  return readdirSync(PATHS.capabilities)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => ({
      file: join(PATHS.capabilities, f),
      name: basename(f, '.yaml'),
      record: readYaml(join(PATHS.capabilities, f)),
    }));
}

/** errors/<owner>.yaml -> [{ file, owner, record }] — düzleştirilmiş kayıtlar */
export function loadErrors() {
  if (!existsSync(PATHS.errors)) return [];
  const out = [];
  for (const f of readdirSync(PATHS.errors).filter((x) => x.endsWith('.yaml')).sort()) {
    const file = join(PATHS.errors, f);
    const doc = readYaml(file);
    for (const record of doc?.errors ?? []) {
      out.push({ file, owner: basename(f, '.yaml'), record });
    }
  }
  return out;
}

export function loadProfiles() {
  return readYaml(PATHS.profiles);
}

export function loadCompatibilityProfile(id) {
  const file = join(PATHS.compatibility, `${id}.yaml`);
  return { file, profile: readYaml(file) };
}

/**
 * Risk metadata'dan seviye türetir. Kurallar yukarıdan aşağıya değerlendirilir;
 * ilk eşleşen kazanır. Kaynak: docs/contracts/capability-registry.md
 *
 * Bu fonksiyon kaydın kendi risk.level değerini DOĞRULAMAK için kullanılır —
 * seviyeyi elle düşürerek bir capability'yi agent'a açmak mümkün olmasın diye.
 */
export function deriveRiskLevel(risk) {
  const { effect, scope, reversibility } = risk;

  if (effect === 'delete' || scope === 'host' || scope === 'production' || reversibility === 'destructive') {
    return 'R4';
  }
  if (reversibility === 'snapshot_recoverable' || ((effect === 'mutation' || effect === 'process') && scope === 'project')) {
    return 'R3';
  }
  if (effect === 'mutation' && (scope === 'fixture' || scope === 'disposable_runtime') && reversibility === 'runtime_discard') {
    return 'R2';
  }
  if (((effect === 'build' || effect === 'process') && scope === 'disposable_runtime') || (effect === 'read' && scope === 'project')) {
    return 'R1';
  }
  if (effect === 'read' && (scope === 'fixture' || scope === 'disposable_runtime')) {
    return 'R0';
  }
  return null; // sınıflandırılamayan kombinasyon: validate-registry hata verir
}

/**
 * Bir capability'nin profil bazında hangi tool adıyla göründüğü.
 *
 * scenario-authoring için developer_tool'a DÜŞÜLMEZ: fallback, her developer
 * tool'unun sessizce scenario-authoring profiline sızmasına yol açardı.
 * Bir tool o profilde görünecekse `authoring_tool` açıkça yazılmalıdır.
 */
export function toolNameFor(record, profile) {
  const e = record.exposure ?? {};
  if (profile === 'developer') return e.developer_tool ?? null;
  if (profile === 'debug') return e.debug_tool ?? null;
  if (profile === 'scenario-authoring') return e.authoring_tool ?? null;
  return null;
}

/**
 * Capability id -> beklenen dosya adı (uzantısız).
 *
 * Hem `.` hem `_` tire yapılır: `player.break_block` -> `player-break-block`.
 * Yalnızca noktayı çevirmek `player-break_block` gibi karışık bir ad üretirdi.
 */
export function fileNameForCapabilityId(id) {
  return id.replace(/[._]/g, '-');
}

/** Generated blokları güncelle: <!-- BEGIN GENERATED: name --> ... <!-- END GENERATED: name --> */
export function replaceGeneratedBlock(content, name, body) {
  const begin = `<!-- BEGIN GENERATED: ${name} -->`;
  const end = `<!-- END GENERATED: ${name} -->`;
  const start = content.indexOf(begin);
  const stop = content.indexOf(end);
  if (start === -1 || stop === -1) {
    throw new Error(`Generated blok bulunamadı: ${name}`);
  }
  return content.slice(0, start + begin.length) + '\n' + body + '\n' + content.slice(stop);
}

export function fail(messages) {
  for (const m of messages) process.stderr.write(`  ✗ ${m}\n`);
  process.stderr.write(`\n${messages.length} hata.\n`);
  process.exit(1);
}

export function ok(label) {
  process.stderr.write(`  ✓ ${label}\n`);
}
