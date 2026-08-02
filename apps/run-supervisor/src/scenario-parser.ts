/**
 * Scenario DSL v1 parser ve validator.
 *
 * Scenario dosyasını parse eder, şemaya ve step allowlist'ine göre doğrular.
 * Çalıştırma yapmaz; yalnızca doğrulama.
 */

import { readFileSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

export type StepName =
  | 'test_actor.create'
  | 'test_actor.disconnect_all'
  | 'player.break_block'
  | 'player.move'
  | 'player.look'
  | 'player.chat'
  | 'plugin.command'
  | 'world.set_block'
  | 'assert.block'
  | 'assert.player_state'
  | 'assert.player_message'
  | 'assert.event'
  | 'assert.no_log'
  | 'assert.plugin_enabled'
  | 'assert.server_state'
  | 'wait';

export const DSL_STEP_ALLOWLIST: readonly StepName[] = [
  'test_actor.create',
  'test_actor.disconnect_all',
  'player.break_block',
  'player.move',
  'player.look',
  'player.chat',
  'plugin.command',
  'world.set_block',
  'assert.block',
  'assert.player_state',
  'assert.player_message',
  'assert.event',
  'assert.no_log',
  'assert.plugin_enabled',
  'assert.server_state',
  'wait',
];

/** Step -> Capability mapping */
export const STEP_CAPABILITY_MAP: Readonly<Record<StepName, string>> = {
  'test_actor.create': 'test_actor.protocol',
  'test_actor.disconnect_all': 'actor.disconnect',
  'player.break_block': 'player.break_block',
  'player.move': 'player.state.read',
  'player.look': 'player.state.read',
  'player.chat': 'actor.message.read',
  'plugin.command': 'plugin.command.typed',
  'world.set_block': 'world.block.write',
  'assert.block': 'world.block.read',
  'assert.player_state': 'player.state.read',
  'assert.player_message': 'actor.message.read',
  'assert.event': 'events.read',
  'assert.no_log': 'logs.read',
  'assert.plugin_enabled': 'plugin.list',
  'assert.server_state': 'server.state.read',
  'wait': 'events.read',
};

export interface Position {
  readonly world_key: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Step {
  readonly [stepName: string]: Record<string, unknown>;
}

export interface ScenarioRequires {
  readonly plugin_contract?: string;
  readonly capabilities?: readonly string[];
}

export interface ScenarioDefinition {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly profile: 'isolated-test';
  readonly timeout: string;
  readonly requires?: ScenarioRequires;
  readonly given: readonly Step[];
  readonly when: readonly Step[];
  readonly then: readonly Step[];
  readonly cleanup: readonly Step[];
}

export interface ValidationError {
  readonly field: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly scenario?: ScenarioDefinition;
  readonly errors: readonly ValidationError[];
  readonly steps: readonly { name: string; index: number }[];
  readonly requiredCapabilities: readonly string[];
}

/**
 * Duration string'ini milisaniyeye çevirir.
 * "60s" -> 60000, "500ms" -> 500, "1m" -> 60000, "20tick" -> 400
 */
export function parseDuration(duration: string): number {
  const match = /^(\d+)(ms|tick|s|m)$/.exec(duration);
  if (!match) return 30_000; // varsayılan 30s
  const value = Number.parseInt(match[1]!, 10);
  switch (match[2]) {
    case 'ms': return value;
    case 'tick': return value * 50;
    case 's': return value * 1000;
    case 'm': return value * 60_000;
    default: return 30_000;
  }
}

/**
 * Step listesinden gerekli capability'leri toplar.
 */
function collectCapabilities(steps: readonly Step[]): string[] {
  const caps = new Set<string>();
  for (const step of steps) {
    const name = Object.keys(step)[0] as StepName;
    const cap = STEP_CAPABILITY_MAP[name];
    if (cap) caps.add(cap);
  }
  return [...caps];
}

/**
 * Scenario dosyasını parse eder ve doğrular.
 */
export function parseScenario(filePath: string): ValidationResult {
  if (!existsSync(filePath)) {
    return {
      valid: false,
      errors: [{ field: 'file', message: `Scenario dosyası bulunamadı: ${filePath}` }],
      steps: [],
      requiredCapabilities: [],
    };
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    const raw = parseYaml(content) as Record<string, unknown>;

    return validateScenario(raw, filePath);
  } catch (err) {
    return {
      valid: false,
      errors: [{ field: 'parse', message: err instanceof Error ? err.message : String(err) }],
      steps: [],
      requiredCapabilities: [],
    };
  }
}

/**
 * Parse edilmiş YAML nesnesini doğrular.
 */
export function validateScenario(raw: Record<string, unknown>, _source?: string): ValidationResult {
  const errors: ValidationError[] = [];

  // version kontrolü
  if (raw['version'] !== 1) {
    errors.push({ field: 'version', message: 'version alanı 1 olmalıdır.' });
  }

  // id kontrolü
  if (typeof raw['id'] !== 'string' || !/^[a-z][a-z0-9-]*$/.test(raw['id'] as string)) {
    errors.push({ field: 'id', message: 'id küçük harf, rakam ve tire içermelidir.' });
  }

  // title kontrolü
  if (typeof raw['title'] !== 'string' || (raw['title'] as string).length < 4) {
    errors.push({ field: 'title', message: 'title alanı en az 4 karakter olmalıdır.' });
  }

  // profile kontrolü
  if (raw['profile'] !== 'isolated-test') {
    errors.push({ field: 'profile', message: 'profile yalnızca "isolated-test" olabilir.' });
  }

  // timeout kontrolü
  if (typeof raw['timeout'] !== 'string' || !/^\d+(ms|tick|s|m)$/.test(raw['timeout'] as string)) {
    errors.push({ field: 'timeout', message: 'timeout geçerli bir süre olmalıdır (örn: 60s, 500ms).' });
  }

  // given/when/then/ cleanup kontrolü
  const phaseKeys = ['given', 'when', 'then', 'cleanup'] as const;
  const allSteps: { name: string; index: number }[] = [];

  for (const key of phaseKeys) {
    const steps = raw[key];
    if (steps !== undefined) {
      if (!Array.isArray(steps)) {
        errors.push({ field: key, message: `${key} bir dizi olmalıdır.` });
        continue;
      }

      if (steps.length > 64) {
        errors.push({ field: key, message: `${key} en fazla 64 adım içerebilir.` });
        continue;
      }

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i] as Record<string, unknown>;
        if (typeof step !== 'object' || step === null) {
          errors.push({ field: `${key}[${i}]`, message: 'Adım bir nesne olmalıdır.' });
          continue;
        }

        const keys = Object.keys(step);
        if (keys.length !== 1) {
          errors.push({ field: `${key}[${i}]`, message: 'Adımda tek bir anahtar olmalıdır.' });
          continue;
        }

        const stepName = keys[0]!;
        if (!(DSL_STEP_ALLOWLIST as readonly string[]).includes(stepName)) {
          errors.push({
            field: `${key}[${i}]`,
            message: `İzin verilmeyen adım: "${stepName}". İzin verilen adımlar: ${DSL_STEP_ALLOWLIST.join(', ')}`,
          });
          continue;
        }

        allSteps.push({ name: stepName, index: allSteps.length });
      }
    }
  }

  // then boşsa hata
  if (!raw['then'] || !Array.isArray(raw['then']) || (raw['then'] as unknown[]).length === 0) {
    errors.push({ field: 'then', message: 'then alanı en az bir assertion içermelidir.' });
  }

  // Gerekli capability'leri topla
  const requiredCapabilities = collectCapabilities(allSteps.map(({ name }) => ({ [name]: {} } as Step)));

  const requires = raw['requires'] as ScenarioRequires | undefined;

  const scenario = errors.length === 0 && typeof raw['id'] === 'string'
    ? {
        version: 1 as const,
        id: raw['id'] as string,
        title: (raw['title'] as string) ?? '',
        profile: 'isolated-test' as const,
        timeout: (raw['timeout'] as string) ?? '60s',
        ...(requires !== undefined ? { requires } : {}),
        given: (raw['given'] as readonly Step[]) ?? [],
        when: (raw['when'] as readonly Step[]) ?? [],
        then: (raw['then'] as readonly Step[]) ?? [],
        cleanup: (raw['cleanup'] as readonly Step[]) ?? [],
      }
    : undefined;

  return {
    valid: errors.length === 0,
    ...(scenario !== undefined ? { scenario } : {}),
    errors,
    steps: allSteps,
    requiredCapabilities,
  };
}
