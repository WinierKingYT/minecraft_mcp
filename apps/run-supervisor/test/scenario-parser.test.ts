/**
 * Scenario Parser Testleri.
 *
 * parseScenario ve validateScenario fonksiyonlarının doğru çalışmasını doğrular.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseScenario,
  validateScenario,
  parseDuration,
  DSL_STEP_ALLOWLIST,
  STEP_CAPABILITY_MAP,
} from '../src/scenario-parser.js';

// ------------------------------------------------------------ Test Helpers

async function createTempScenario(content: string, filename = 'test-scenario.yaml'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'scenario-test-'));
  const filePath = join(dir, filename);
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

// ------------------------------------------------------------ parseDuration

test('parseDuration: saniye dönüşümü', () => {
  assert.equal(parseDuration('60s'), 60_000);
  assert.equal(parseDuration('1s'), 1_000);
});

test('parseDuration: milisaniye dönüşümü', () => {
  assert.equal(parseDuration('500ms'), 500);
  assert.equal(parseDuration('1ms'), 1);
});

test('parseDuration: tick dönüşümü', () => {
  assert.equal(parseDuration('20tick'), 1_000);
  assert.equal(parseDuration('1tick'), 50);
});

test('parseDuration: dakika dönüşümü', () => {
  assert.equal(parseDuration('1m'), 60_000);
  assert.equal(parseDuration('5m'), 300_000);
});

test('parseDuration: geçersiz format varsayılan değer döner', () => {
  assert.equal(parseDuration('invalid'), 30_000);
  assert.equal(parseDuration('10'), 30_000);
  assert.equal(parseDuration(''), 30_000);
});

// ------------------------------------------------------------ DSL_STEP_ALLOWLIST

test('DSL_STEP_ALLOWLIST: 17 step içerir', () => {
  assert.equal(DSL_STEP_ALLOWLIST.length, 17);
});

test('DSL_STEP_ALLOWLIST: gerekli adımları içerir', () => {
  const required = [
    'test_actor.create',
    'test_actor.disconnect_all',
    'world.set_block',
    'world.set_chunk_ticket',
    'assert.block',
    'assert.event',
    'assert.no_log',
  ];
  for (const step of required) {
    assert.ok(
      (DSL_STEP_ALLOWLIST as readonly string[]).includes(step),
      `${step} allowlist'te bulunmalı`,
    );
  }
});

// ------------------------------------------------------------ STEP_CAPABILITY_MAP

test('STEP_CAPABILITY_MAP: tum steplerin capability mappingi var', () => {
  for (const step of DSL_STEP_ALLOWLIST) {
    const cap = STEP_CAPABILITY_MAP[step];
    assert.ok(cap, `${step} için capability mapping tanımlı değil`);
    assert.ok(cap.includes('.'), `${step} capability formatı geçersiz: ${cap}`);
  }
});

// ------------------------------------------------------------ validateScenario

test('validateScenario: geçerli scenario başarılı', () => {
  const raw = {
    version: 1,
    id: 'test-scenario',
    title: 'Test scenario basligi',
    profile: 'isolated-test',
    timeout: '60s',
    given: [],
    when: [],
    then: [{ 'assert.event': { type: 'plugin.enabled' } }],
    cleanup: [],
  };

  const result = validateScenario(raw);
  assert.ok(result.valid);
  assert.equal(result.errors.length, 0);
  assert.equal(result.scenario?.id, 'test-scenario');
  assert.equal(result.steps.length, 1);
});

test('validateScenario: version hatası', () => {
  const raw = {
    version: 2,
    id: 'test',
    title: 'Test',
    profile: 'isolated-test',
    timeout: '60s',
    then: [{ 'assert.event': { type: 'test' } }],
  };

  const result = validateScenario(raw);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.field === 'version'));
});

test('validateScenario: id formatı hatası', () => {
  const raw = {
    version: 1,
    id: 'INVALID_ID',
    title: 'Test',
    profile: 'isolated-test',
    timeout: '60s',
    then: [{ 'assert.event': { type: 'test' } }],
  };

  const result = validateScenario(raw);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.field === 'id'));
});

test('validateScenario: title kısa ise hata', () => {
  const raw = {
    version: 1,
    id: 'test',
    title: 'ab',
    profile: 'isolated-test',
    timeout: '60s',
    then: [{ 'assert.event': { type: 'test' } }],
  };

  const result = validateScenario(raw);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.field === 'title'));
});

test('validateScenario: profile yanlışa hata', () => {
  const raw = {
    version: 1,
    id: 'test',
    title: 'Test',
    profile: 'wrong-profile',
    timeout: '60s',
    then: [{ 'assert.event': { type: 'test' } }],
  };

  const result = validateScenario(raw);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.field === 'profile'));
});

test('validateScenario: timeout formatı yanlışa hata', () => {
  const raw = {
    version: 1,
    id: 'test',
    title: 'Test',
    profile: 'isolated-test',
    timeout: 'invalid',
    then: [{ 'assert.event': { type: 'test' } }],
  };

  const result = validateScenario(raw);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.field === 'timeout'));
});

test('validateScenario: then boşsa hata', () => {
  const raw = {
    version: 1,
    id: 'test',
    title: 'Test',
    profile: 'isolated-test',
    timeout: '60s',
    then: [],
  };

  const result = validateScenario(raw);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.field === 'then'));
});

test('validateScenario: izin verilmeyen step hata', () => {
  const raw = {
    version: 1,
    id: 'test',
    title: 'Test',
    profile: 'isolated-test',
    timeout: '60s',
    when: [{ 'invalid.step': {} }],
    then: [{ 'assert.event': { type: 'test' } }],
  };

  const result = validateScenario(raw);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.message.includes('İzin verilmeyen')));
});

test('validateScenario: capability toplama', () => {
  const raw = {
    version: 1,
    id: 'test',
    title: 'Test',
    profile: 'isolated-test',
    timeout: '60s',
    given: [{ 'world.set_block': { position: { world_key: 'test:overworld', x: 0, y: 0, z: 0 }, material: 'stone' } }],
    when: [],
    then: [{ 'assert.block': { position: { world_key: 'test:overworld', x: 0, y: 0, z: 0 } } }],
  };

  const result = validateScenario(raw);
  assert.ok(result.valid);
  assert.ok(result.requiredCapabilities.includes('world.block.write'));
  assert.ok(result.requiredCapabilities.includes('world.block.read'));
});

// ------------------------------------------------------------ parseScenario

test('parseScenario: dosya yoksa hata', () => {
  const result = parseScenario('/nonexistent/path.yaml');
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.field === 'file'));
});

test('parseScenario: geçerli dosya başarılı', async () => {
  const yaml = `
version: 1
id: test-scenario
title: Test scenario basligi
profile: isolated-test
timeout: 60s
given:
  - world.set_block:
      position:
        world_key: test:overworld
        x: 0
        y: 64
        z: 0
      material: minecraft:stone
when: []
then:
  - assert.block:
      position:
        world_key: test:overworld
        x: 0
        y: 64
        z: 0
      material: minecraft:stone
      within: 5s
cleanup: []
`;

  const filePath = await createTempScenario(yaml);
  const result = parseScenario(filePath);
  assert.ok(result.valid);
  assert.equal(result.scenario?.id, 'test-scenario');
  assert.equal(result.steps.length, 2);
  assert.ok(result.requiredCapabilities.includes('world.block.write'));
  assert.ok(result.requiredCapabilities.includes('world.block.read'));
});

test('parseScenario: bozuk YAML hata', async () => {
  const yaml = `
version: 1
id: test
title: Test
profile: isolated-test
timeout: 60s
then:
  - invalid yaml: [
`;

  const filePath = await createTempScenario(yaml);
  const result = parseScenario(filePath);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.field === 'parse'));
});

test('parseScenario: requires alanı opsiyonel', async () => {
  const yaml = `
version: 1
id: test-scenario
title: Test scenario basligi
profile: isolated-test
timeout: 60s
requires:
  capabilities:
    - events.read
then:
  - assert.event:
      type: plugin.enabled
`;

  const filePath = await createTempScenario(yaml);
  const result = parseScenario(filePath);
  assert.ok(result.valid);
  assert.ok(result.requiredCapabilities.includes('events.read'));
});

test('parseScenario: birden fazla step', async () => {
  const yaml = `
version: 1
id: multi-step
title: Cok adimli test senaryosu
profile: isolated-test
timeout: 120s
given:
  - world.set_block:
      position:
        world_key: test:overworld
        x: 10
        y: 64
        z: 10
      material: minecraft:diamond_block
when:
  - wait:
      duration: 1s
then:
  - assert.block:
      position:
        world_key: test:overworld
        x: 10
        y: 64
        z: 10
      material: minecraft:diamond_block
  - assert.no_log:
      level_at_least: ERROR
cleanup:
  - world.set_block:
      position:
        world_key: test:overworld
        x: 10
        y: 64
        z: 10
      material: minecraft:air
`;

  const filePath = await createTempScenario(yaml);
  const result = parseScenario(filePath);
  assert.ok(result.valid);
  assert.equal(result.steps.length, 5); // 1 given + 1 when + 2 then + 1 cleanup
  assert.equal(result.scenario?.given.length, 1);
  assert.equal(result.scenario?.when.length, 1);
  assert.equal(result.scenario?.then.length, 2);
  assert.equal(result.scenario?.cleanup.length, 1);
});

// ------------------------------------------------------------ expect bloğu

test('validateScenario: expect failed + error_code geçerli, then boş olabilir', () => {
  const raw = {
    version: 1,
    id: 'expect-failure',
    title: 'Beklenen hata scenario',
    profile: 'isolated-test',
    timeout: '60s',
    expect: { status: 'failed', error_code: 'CHUNK_NOT_LOADED' },
    given: [],
    when: [{ 'world.set_block': { position: { world_key: 'test:overworld', x: 40, y: 64, z: 40 }, material: 'minecraft:chest' } }],
    then: [],
    cleanup: [],
  };

  const result = validateScenario(raw);
  assert.ok(result.valid, JSON.stringify(result.errors));
  assert.equal(result.scenario?.expect?.status, 'failed');
  assert.equal(result.scenario?.expect?.error_code, 'CHUNK_NOT_LOADED');
});

test('validateScenario: expect completed + boş then hata verir', () => {
  const raw = {
    version: 1,
    id: 'expect-completed',
    title: 'Beklenen basari scenario',
    profile: 'isolated-test',
    timeout: '60s',
    expect: { status: 'completed' },
    given: [],
    when: [],
    then: [],
    cleanup: [],
  };

  const result = validateScenario(raw);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.field === 'then'));
});

test('validateScenario: expect.status geçersizse hata', () => {
  const raw = {
    version: 1,
    id: 'expect-bad',
    title: 'Gecersiz expect',
    profile: 'isolated-test',
    timeout: '60s',
    expect: { status: 'cancelled' },
    given: [],
    when: [],
    then: [{ 'assert.event': { type: 'test' } }],
    cleanup: [],
  };

  const result = validateScenario(raw);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.field === 'expect.status'));
});

test('validateScenario: expect.error_code deseni geçersizse hata', () => {
  const raw = {
    version: 1,
    id: 'expect-bad-code',
    title: 'Gecersiz hata kodu',
    profile: 'isolated-test',
    timeout: '60s',
    expect: { status: 'failed', error_code: 'küçük-kod' },
    given: [],
    when: [],
    then: [],
    cleanup: [],
  };

  const result = validateScenario(raw);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.field === 'expect.error_code'));
});

test('parseScenario: expect bloğu olmayan scenario expect taşımaz', async () => {
  const yaml = `
version: 1
id: no-expect
title: Expectsiz test senaryosu
profile: isolated-test
timeout: 60s
given: []
when: []
then:
  - assert.event:
      type: test
cleanup: []
`;

  const filePath = await createTempScenario(yaml);
  const result = parseScenario(filePath);
  assert.ok(result.valid);
  assert.equal(result.scenario?.expect, undefined);
});
