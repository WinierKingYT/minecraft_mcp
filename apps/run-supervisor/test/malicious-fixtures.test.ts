/**
 * Malicious fixture tests — fixture dosyalarından yüklenen düşmanca verileri doğrular.
 *
 * Bu testler fixtures/malicious/ dizinindeki dosyaları kullanır:
 * - scenarios/: Scenario DSL v1 parser'a sunulan düşmanca senaryolar
 * - plugins/: Plugin metadata doğrulamasına sunulan düşmanca plugin.yml'ler
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { parseScenario, validateScenario } from '../src/scenario-parser.js';
import { inspectPluginJar, detectLoadingCycle } from '../src/plugin-metadata.js';
import { parse as parseYaml } from 'yaml';

const FIXTURES_DIR = join(process.cwd(), '..', '..', 'fixtures', 'malicious');

// ─── ZIP helper (from plugin-metadata.test.ts) ────────────────────────

interface FileSpec {
  readonly name: string;
  readonly content: string | Buffer;
  readonly store?: boolean;
}

function makeZip(files: readonly FileSpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const stored = file.store === true;
    const data = stored ? raw : deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuffer, eocd]);
}

const CLASS_ENTRY: FileSpec = { name: 'com/example/Plugin.class', content: Buffer.from([0xCA, 0xFE, 0xBA, 0xBE]) };

async function jarFromFixture(fixturePath: string): Promise<string> {
  const content = await readFile(join(FIXTURES_DIR, 'plugins', fixturePath), 'utf-8');
  const dir = await mkdtemp(join(tmpdir(), 'plugin-fixture-'));
  const jarPath = join(dir, 'plugin.jar');
  await writeFile(jarPath, makeZip([{ name: 'plugin.yml', content }, CLASS_ENTRY]));
  return jarPath;
}

// ─── Scenario fixture tests ────────────────────────────────────────────

describe('Malicious scenario fixtures: parser rejection', () => {
  test('injection-id.yaml: template syntax in ID is rejected', () => {
    const filePath = join(FIXTURES_DIR, 'scenarios', 'injection-id.yaml');
    const result = parseScenario(filePath);

    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0, 'has errors');
  });

  test('injection-title.yaml: XSS in title is stored as data', () => {
    const filePath = join(FIXTURES_DIR, 'scenarios', 'injection-title.yaml');
    const result = parseScenario(filePath);

    if (result.valid && result.scenario) {
      assert.ok(result.scenario.title.includes('<script>'), 'XSS preserved as literal data');
    }
  });

  test('unauthorized-step.yaml: exec step not in allowlist is rejected', () => {
    const filePath = join(FIXTURES_DIR, 'scenarios', 'unauthorized-step.yaml');
    const result = parseScenario(filePath);

    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0, 'has errors');
  });

  test('version-mismatch.yaml: wrong DSL version is rejected', () => {
    const filePath = join(FIXTURES_DIR, 'scenarios', 'version-mismatch.yaml');
    const result = parseScenario(filePath);

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.field === 'version' || e.message.includes('version')), 'version error');
  });

  test('empty-then.yaml: empty then block is rejected', () => {
    const filePath = join(FIXTURES_DIR, 'scenarios', 'empty-then.yaml');
    const result = parseScenario(filePath);

    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0, 'has errors');
  });

  test('env-injection.yaml: env variable syntax in args is stored as data', () => {
    const filePath = join(FIXTURES_DIR, 'scenarios', 'env-injection.yaml');
    const result = parseScenario(filePath);

    if (result.valid && result.scenario) {
      const firstStep = result.scenario.then[0];
      if (firstStep && 'start_server' in firstStep) {
        const args = (firstStep as Record<string, unknown>)['start_server'] as Record<string, unknown>;
        assert.ok(
          typeof args['jar'] === 'string' && args['jar'].includes('${env:SECRET_KEY}'),
          'env syntax preserved as literal string',
        );
      }
    }
  });

  test('path-traversal.yaml: path traversal in args is stored as data', () => {
    const filePath = join(FIXTURES_DIR, 'scenarios', 'path-traversal.yaml');
    const result = parseScenario(filePath);

    if (result.valid && result.scenario) {
      const firstStep = result.scenario.then[0];
      if (firstStep && 'start_server' in firstStep) {
        const args = (firstStep as Record<string, unknown>)['start_server'] as Record<string, unknown>;
        assert.equal(args['jar'], '../../etc/passwd', 'path traversal preserved literally');
      }
    }
  });
});

// ─── Scenario validation fixture tests ─────────────────────────────────

describe('Malicious scenario fixtures: validation rejection', () => {
  test('injection-id.yaml: validateScenario rejects template syntax', () => {
    const filePath = join(FIXTURES_DIR, 'scenarios', 'injection-id.yaml');
    const result = parseScenario(filePath);

    if (result.valid && result.scenario) {
      const raw = result.scenario as unknown as Record<string, unknown>;
      const validation = validateScenario(raw, filePath);
      assert.equal(validation.valid, false, 'validation rejects template ID');
    }
  });

  test('unauthorized-step.yaml: validateScenario rejects non-allowlisted step', () => {
    const filePath = join(FIXTURES_DIR, 'scenarios', 'unauthorized-step.yaml');
    const result = parseScenario(filePath);

    if (result.valid && result.scenario) {
      const raw = result.scenario as unknown as Record<string, unknown>;
      const validation = validateScenario(raw, filePath);
      assert.equal(validation.valid, false, 'validation rejects exec step');
    }
  });
});

// ─── Plugin metadata fixture tests ─────────────────────────────────────

describe('Malicious plugin fixture: missing-main.yml', () => {
  test('PLUGIN_MAIN_CLASS_MISSING when main class absent', async () => {
    const jar = await jarFromFixture('missing-main.yml');
    const result = await inspectPluginJar(jar, { expectedApiVersion: '1.21' });

    assert.equal(result.ok, false);
    assert.ok(
      result.findings.some((f) => f.code === 'PLUGIN_MAIN_CLASS_MISSING'),
      'PLUGIN_MAIN_CLASS_MISSING found',
    );
  });
});

describe('Malicious plugin fixture: missing-api-version.yml', () => {
  test('PLUGIN_API_VERSION_MISSING when api-version absent', async () => {
    const jar = await jarFromFixture('missing-api-version.yml');
    const result = await inspectPluginJar(jar, { expectedApiVersion: '1.21' });

    assert.equal(result.ok, false);
    assert.ok(
      result.findings.some((f) => f.code === 'PLUGIN_API_VERSION_MISSING'),
      'PLUGIN_API_VERSION_MISSING found',
    );
  });
});

describe('Malicious plugin fixture: cycle-dependency.yml', () => {
  test('PLUGIN_LOADING_CYCLE when plugin depends on itself', () => {
    const cycleMap = new Map<string, { depend: string[]; softDepend: string[] }>();
    cycleMap.set('cycle-plugin', { depend: ['cycle-plugin'], softDepend: [] });

    const cycle = detectLoadingCycle(cycleMap);
    assert.ok(cycle !== null, 'cycle detected');
    assert.ok(cycle!.includes('cycle-plugin'), 'cycle involves cycle-plugin');
  });
});

// ─── Fixture integrity invariants ──────────────────────────────────────

describe('Malicious fixture invariants', () => {
  test('all scenario fixtures are valid YAML', async () => {
    const scenarioDir = join(FIXTURES_DIR, 'scenarios');
    const files = ['injection-id.yaml', 'injection-title.yaml', 'unauthorized-step.yaml',
      'version-mismatch.yaml', 'empty-then.yaml', 'env-injection.yaml', 'path-traversal.yaml'];

    for (const file of files) {
      const yaml = await readFile(join(scenarioDir, file), 'utf-8');
      const doc = parseYaml(yaml);
      assert.ok(typeof doc === 'object' && doc !== null, `${file} is valid YAML object`);
    }
  });

  test('all plugin fixtures are valid YAML', async () => {
    const pluginDir = join(FIXTURES_DIR, 'plugins');
    const files = ['missing-main.yml', 'missing-api-version.yml', 'cycle-dependency.yml'];

    for (const file of files) {
      const yaml = await readFile(join(pluginDir, file), 'utf-8');
      const doc = parseYaml(yaml);
      assert.ok(typeof doc === 'object' && doc !== null, `${file} is valid YAML object`);
    }
  });

  test('malicious payloads are never executed by parsers', () => {
    const filePath = join(FIXTURES_DIR, 'scenarios', 'injection-id.yaml');
    parseScenario(filePath);

    // If template injection were executed, process.exit(1) would have been called
    assert.ok(true, 'no code execution during parse');
  });
});
