/**
 * Paper plugin metadata keşfi ve doğrulaması.
 *
 * docs/contracts/plugin-test-contract.md ve ADR-0005:
 *   - V1'in resmî desteği klasik `plugin.yml` içindir.
 *   - `paper-plugin.yml` feature flag arkasında deneyseldir; kapalıyken
 *     SESSİZCE yok sayılmaz, `PAPER_PLUGIN_EXPERIMENTAL_DISABLED` üretilir.
 *   - İki biçim birlikte bulunduğunda örtük bir "hangisi daha yeni" kuralı
 *     YOKTUR; öncelik açık manifest politikasıyla belirlenir.
 */

import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { readZipEntries, readZipEntry, jarContainsClass, type ZipEntry } from './zip-reader.js';
import type { ValidationFinding } from './gradle-validation.js';

export const PLUGIN_YML = 'plugin.yml';
export const PAPER_PLUGIN_YML = 'paper-plugin.yml';

export interface PluginCommand {
  readonly name: string;
  readonly description: string | null;
  readonly usage: string | null;
  readonly permission: string | null;
  readonly aliases: readonly string[];
}

export interface PluginPermission {
  readonly name: string;
  readonly description: string | null;
  readonly default: boolean;
  readonly children: readonly string[];
}

export interface PluginMetadata {
  readonly source: 'plugin.yml' | 'paper-plugin.yml';
  readonly name: string | null;
  readonly version: string | null;
  readonly main: string | null;
  readonly apiVersion: string | null;
  readonly depend: readonly string[];
  readonly softDepend: readonly string[];
  readonly loadBefore: readonly string[];
  readonly load: string | null;
  readonly commands: readonly PluginCommand[];
  readonly permissions: readonly PluginPermission[];
}

export interface PluginInspection {
  readonly ok: boolean;
  readonly metadata: PluginMetadata | null;
  readonly findings: readonly ValidationFinding[];
  readonly hasPluginYml: boolean;
  readonly hasPaperPluginYml: boolean;
  readonly entryCount: number;
}

export interface PluginInspectOptions {
  /** Uyumluluk profilindeki `paper.api_version`. */
  readonly expectedApiVersion: string;
  /** ADR-0005: varsayılan kapalı. */
  readonly paperPluginExperimentalEnabled?: boolean;
  /** Aynı runtime'a yüklenecek diğer plugin adları — duplicate tespiti için. */
  readonly otherPluginNames?: readonly string[];
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return typeof value === 'string' ? [value] : [];
}

function parseCommands(doc: Record<string, unknown>): PluginCommand[] {
  const rawCommands = doc['commands'] as Record<string, unknown> | undefined;
  if (!rawCommands || typeof rawCommands !== 'object') return [];

  const commands: PluginCommand[] = [];
  for (const [name, value] of Object.entries(rawCommands)) {
    if (typeof value !== 'object' || value === null) continue;
    const cmd = value as Record<string, unknown>;
    commands.push({
      name,
      description: typeof cmd['description'] === 'string' ? cmd['description'] : null,
      usage: typeof cmd['usage'] === 'string' ? cmd['usage'] : null,
      permission: typeof cmd['permission'] === 'string' ? cmd['permission'] : null,
      aliases: asStringArray(cmd['aliases']),
    });
  }
  return commands;
}

function parsePermissions(doc: Record<string, unknown>): PluginPermission[] {
  const rawPerms = doc['permissions'] as Record<string, unknown> | undefined;
  if (!rawPerms || typeof rawPerms !== 'object') return [];

  const permissions: PluginPermission[] = [];
  for (const [name, value] of Object.entries(rawPerms)) {
    if (typeof value !== 'object' || value === null) continue;
    const perm = value as Record<string, unknown>;
    permissions.push({
      name,
      description: typeof perm['description'] === 'string' ? perm['description'] : null,
      default: perm['default'] === true,
      children: asStringArray(perm['children']),
    });
  }
  return permissions;
}

function parseMetadata(raw: string, source: PluginMetadata['source']): PluginMetadata {
  // Güvenli parser: custom tag yok, yalnızca veri (DSL-02 ile aynı ilke).
  const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;

  const apiVersion = doc['api-version'];
  return {
    source,
    name: typeof doc['name'] === 'string' ? doc['name'] : null,
    version: typeof doc['version'] === 'string' ? doc['version'] : String(doc['version'] ?? '') || null,
    main: typeof doc['main'] === 'string' ? doc['main'] : null,
    // api-version YAML'da 1.21 gibi sayı olarak ayrıştırılabilir.
    apiVersion: apiVersion === undefined || apiVersion === null ? null : String(apiVersion),
    depend: asStringArray(doc['depend']),
    softDepend: asStringArray(doc['softdepend']),
    loadBefore: asStringArray(doc['loadbefore']),
    load: typeof doc['load'] === 'string' ? doc['load'] : null,
    commands: parseCommands(doc),
    permissions: parsePermissions(doc),
  };
}

/** Yükleme sırası tanımlarında döngü var mı? */
export function detectLoadingCycle(
  plugins: ReadonlyMap<string, { depend: readonly string[]; softDepend: readonly string[] }>,
): string[] | null {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (name: string): string[] | null => {
    const current = state.get(name);
    if (current === 'done') return null;
    if (current === 'visiting') {
      // Döngüyü başladığı yerden itibaren döndür.
      return [...stack.slice(stack.indexOf(name)), name];
    }

    state.set(name, 'visiting');
    stack.push(name);

    const node = plugins.get(name);
    for (const dependency of [...(node?.depend ?? []), ...(node?.softDepend ?? [])]) {
      if (!plugins.has(dependency)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }

    stack.pop();
    state.set(name, 'done');
    return null;
  };

  for (const name of plugins.keys()) {
    const cycle = visit(name);
    if (cycle) return cycle;
  }
  return null;
}

export async function inspectPluginJar(
  jarPath: string,
  options: PluginInspectOptions,
): Promise<PluginInspection> {
  const findings: ValidationFinding[] = [];
  const add = (
    code: string,
    message: string,
    suggestedAction: string,
    severity: 'error' | 'warning' = 'error',
  ): void => {
    findings.push({ code, severity, message, suggestedAction, path: jarPath });
  };

  const buffer = await readFile(jarPath);
  let entries: ZipEntry[];
  try {
    entries = readZipEntries(buffer);
  } catch (err) {
    add(
      (err as { code?: string }).code ?? 'ARCHIVE_INVALID',
      err instanceof Error ? err.message : String(err),
      'JAR dosyasının bozuk olmadığını doğrulayın; build çıktısını yeniden üretin.',
    );
    return { ok: false, metadata: null, findings, hasPluginYml: false, hasPaperPluginYml: false, entryCount: 0 };
  }

  const pluginYml = entries.find((e) => e.name === PLUGIN_YML && !e.isDirectory);
  const paperPluginYml = entries.find((e) => e.name === PAPER_PLUGIN_YML && !e.isDirectory);
  const experimentalEnabled = options.paperPluginExperimentalEnabled === true;

  if (!pluginYml && !paperPluginYml) {
    add(
      'PLUGIN_METADATA_NOT_FOUND',
      'JAR içinde plugin.yml bulunamadı.',
      'src/main/resources/plugin.yml dosyasını ekleyin; V1\'in resmî desteği klasik plugin.yml içindir.',
    );
    return {
      ok: false,
      metadata: null,
      findings,
      hasPluginYml: false,
      hasPaperPluginYml: false,
      entryCount: entries.length,
    };
  }

  // ADR-0005: yalnızca paper-plugin.yml varsa ve deneysel destek kapalıysa,
  // sessizce yok saymak yerine açık hata üretilir.
  if (!pluginYml && paperPluginYml && !experimentalEnabled) {
    add(
      'PAPER_PLUGIN_EXPERIMENTAL_DISABLED',
      'JAR yalnızca paper-plugin.yml içeriyor; deneysel destek kapalı.',
      'Deneysel desteği feature flag ile açın veya klasik plugin.yml kullanın.',
    );
    return {
      ok: false,
      metadata: null,
      findings,
      hasPluginYml: false,
      hasPaperPluginYml: true,
      entryCount: entries.length,
    };
  }

  if (pluginYml && paperPluginYml) {
    // Örtük öncelik kuralı YOK: hangi metadata'nın kullanıldığı raporda
    // kanıtlanabilir olmalıdır.
    add(
      'PLUGIN_METADATA_AMBIGUOUS',
      'JAR hem plugin.yml hem paper-plugin.yml içeriyor.',
      'Açık manifest politikası belirleyin; örtük öncelik kuralı yoktur.',
      experimentalEnabled ? 'error' : 'warning',
    );
  }

  const chosen = pluginYml ?? paperPluginYml!;
  const source: PluginMetadata['source'] = chosen === pluginYml ? 'plugin.yml' : 'paper-plugin.yml';

  let metadata: PluginMetadata;
  try {
    metadata = parseMetadata(readZipEntry(buffer, chosen).toString('utf8'), source);
  } catch (err) {
    add(
      'PLUGIN_METADATA_NOT_FOUND',
      `${source} ayrıştırılamadı: ${err instanceof Error ? err.message : String(err)}`,
      'YAML söz dizimini düzeltin.',
    );
    return {
      ok: false,
      metadata: null,
      findings,
      hasPluginYml: pluginYml !== undefined,
      hasPaperPluginYml: paperPluginYml !== undefined,
      entryCount: entries.length,
    };
  }

  // ---- Zorunlu alanlar ----------------------------------------------------
  for (const [field, value] of [
    ['name', metadata.name],
    ['version', metadata.version],
    ['main', metadata.main],
  ] as const) {
    if (!value) {
      add(
        'PLUGIN_METADATA_NOT_FOUND',
        `${source} içinde zorunlu alan eksik: ${field}`,
        `${field} alanını ekleyin.`,
      );
    }
  }

  // ---- Main class JAR içinde var mı? --------------------------------------
  if (metadata.main && !jarContainsClass(entries, metadata.main)) {
    add(
      'PLUGIN_MAIN_CLASS_MISSING',
      `main sınıfı JAR içinde bulunamadı: ${metadata.main}`,
      'main değerini tam sınıf adıyla düzeltin ve sınıfın derlendiğini doğrulayın.',
    );
  }

  // ---- api-version --------------------------------------------------------
  if (!metadata.apiVersion) {
    add(
      'PLUGIN_API_VERSION_MISSING',
      `${source} içinde api-version tanımlı değil.`,
      `api-version alanını "${options.expectedApiVersion}" olarak ekleyin.`,
    );
  } else if (metadata.apiVersion !== options.expectedApiVersion) {
    add(
      'PLUGIN_API_VERSION_INCOMPATIBLE',
      `api-version "${metadata.apiVersion}"; uyumluluk profili "${options.expectedApiVersion}" bekliyor.`,
      'api-version, Paper build ve Paper API koordinatını birbiriyle tutarlı hâle getirin.',
    );
  }

  // ---- Duplicate ad -------------------------------------------------------
  if (metadata.name && options.otherPluginNames?.includes(metadata.name)) {
    add(
      'PLUGIN_NAME_CONFLICT',
      `Aynı plugin adı runtime'da zaten mevcut: ${metadata.name}`,
      'Çakışan plugin adlarından birini değiştirin veya çakışan test dependency\'yi kaldırın.',
    );
  }

  // ---- Kendine bağımlılık -------------------------------------------------
  if (metadata.name && [...metadata.depend, ...metadata.softDepend].includes(metadata.name)) {
    add(
      'PLUGIN_LOADING_CYCLE',
      `Plugin kendine bağımlı: ${metadata.name}`,
      'depend / softdepend listesinden kendi adını çıkarın.',
    );
  }

  // ---- Komut tanımları ----------------------------------------------------
  const commandNames = new Set<string>();
  for (const cmd of metadata.commands) {
    // Komut adı çakışması
    if (commandNames.has(cmd.name)) {
      add(
        'PLUGIN_METADATA_NOT_FOUND',
        `Çakışan komut adı: ${cmd.name}`,
        'Komut adlarını benzersiz yapın.',
        'warning',
      );
    }
    commandNames.add(cmd.name);

    // Komut adı formatı
    if (!/^[a-z][a-z0-9_-]*$/.test(cmd.name)) {
      add(
        'PLUGIN_METADATA_NOT_FOUND',
        `Geçersiz komut adı formatı: ${cmd.name}`,
        'Komut adları küçük harf, rakam, tire ve alt çizgi içermelidir.',
        'warning',
      );
    }
  }

  // ---- İzin tanımları -----------------------------------------------------
  const permissionNames = new Set<string>();
  for (const perm of metadata.permissions) {
    // İzin adı çakışması
    if (permissionNames.has(perm.name)) {
      add(
        'PLUGIN_METADATA_NOT_FOUND',
        `Çakışan izin adı: ${perm.name}`,
        'İzin adlarını benzersiz yapın.',
        'warning',
      );
    }
    permissionNames.add(perm.name);

    // İzin adı formatı (nokta ile ayrılmış)
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(perm.name)) {
      add(
        'PLUGIN_METADATA_NOT_FOUND',
        `Geçersiz izin adı formatı: ${perm.name}`,
        'İzin adları nokta ile ayrılmış küçük harf ve rakam içermelidir.',
        'warning',
      );
    }

    // Çocuk izinlerin varlığı
    for (const child of perm.children) {
      if (!permissionNames.has(child)) {
        add(
          'PLUGIN_METADATA_NOT_FOUND',
          `İzin tanımlanmamış çocuk izin: ${child}`,
          `Çocuk izin "${child}" için tanımlama ekleyin.`,
          'warning',
        );
      }
    }
  }

  // ---- Komut izin kontrolü ------------------------------------------------
  for (const cmd of metadata.commands) {
    if (cmd.permission && !permissionNames.has(cmd.permission)) {
      add(
        'PLUGIN_METADATA_NOT_FOUND',
        `Komut "${cmd.name}" tanımlanmamış izini kullanıyor: ${cmd.permission}`,
        `İzin "${cmd.permission}" için tanımlama ekleyin.`,
        'warning',
      );
    }
  }

  return {
    ok: findings.every((f) => f.severity !== 'error'),
    metadata,
    findings,
    hasPluginYml: pluginYml !== undefined,
    hasPaperPluginYml: paperPluginYml !== undefined,
    entryCount: entries.length,
  };
}
