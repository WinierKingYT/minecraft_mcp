/**
 * Scenario Engine Testleri — M2A runtime provisioning.
 *
 * determinism.md DSL-11: scenario'lar runtime paylaşmaz; engine, runtimeProvider
 * üzerinden her scenario için yeni bir disposable runtime ister ve run() sonunda
 * disposeRuntime() ile temiz kapatır.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScenarioEngine, type BridgeClientLike, type ProvisionedRuntime } from '../src/scenario-engine.js';
import { ActorClient } from '../src/actor-client.js';
import { BridgeClientError } from '../src/bridge-client.js';
import type { ScenarioDefinition } from '../src/scenario-parser.js';

// ------------------------------------------------------------ Test Helpers

interface FakeBridge extends BridgeClientLike {
  readonly actions: Array<{
    operation: string;
    args: Record<string, unknown>;
    idempotencyKey: string | undefined;
  }>;
  readonly queries: Array<{ operation: string; args: Record<string, unknown> }>;
  setBlock(worldKey: string, x: number, y: number, z: number, material: string): void;
}

function createFakeBridge(): FakeBridge {
  const blocks = new Map<string, string>();
  const actions: FakeBridge['actions'] = [];
  const queries: FakeBridge['queries'] = [];

  return {
    actions,
    queries,
    setBlock(worldKey, x, y, z, material) {
      blocks.set(`${worldKey},${x},${y},${z}`, material);
    },
    async query(operation, args) {
      queries.push({ operation, args });
      if (operation === 'world.get_block') {
        const key = `${args['world_key']},${args['x']},${args['y']},${args['z']}`;
        return { material: blocks.get(key) ?? 'minecraft:air' };
      }
      return {};
    },
    async action(operation, args, idempotencyKey) {
      actions.push({ operation, args, idempotencyKey });
      if (operation === 'world.set_block') {
        blocks.set(
          `${args['world_key']},${args['x']},${args['y']},${args['z']}`,
          args['material'] as string,
        );
      }
      return {};
    },
    async events() {
      return [];
    },
  };
}

/**
 * Belirli bir action'da BridgeClientError koduyla hata fırlatan bridge.
 * Config error scenario testleri (DSL-12) için kullanılır.
 */
function createFailingBridge(errorCode: string): FakeBridge {
  const actions: FakeBridge['actions'] = [];
  const queries: FakeBridge['queries'] = [];

  return {
    actions,
    queries,
    setBlock() {},
    async query() {
      return {};
    },
    async action(operation, args, idempotencyKey) {
      actions.push({ operation, args, idempotencyKey });
      throw new BridgeClientError(errorCode, `Beklenen hata: ${errorCode}`);
    },
    async events() {
      return [];
    },
  };
}

function createRecordingProvider(bridge: FakeBridge, disposeLog: string[] = []) {
  const calls: Array<{ runId: string; scenarioId: string }> = [];
  return {
    calls,
    provider: async (
      scenario: ScenarioDefinition,
      runId: string,
    ): Promise<ProvisionedRuntime> => {
      calls.push({ runId, scenarioId: scenario.id });
      return {
        runtimeImageId: `rt_test_${calls.length}`,
        bridgeBootId: 'boot_test',
        bridgeClient: bridge,
        dispose: async () => {
          disposeLog.push('disposed');
        },
      };
    },
  };
}

async function writeScenario(content: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'scenario-engine-test-'));
  const path = join(dir, 'scenario.yaml');
  await writeFile(path, content, 'utf8');
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// ------------------------------------------------------------ Provisioning

test('engine: runtimeProvider her run için çağrılır ve runtime provision edilir', async () => {
  const bridge = createFakeBridge();
  const { calls, provider } = createRecordingProvider(bridge);
  const { path, cleanup } = await writeScenario(`
version: 1
id: smoke-test
title: Smoke provisioning
profile: isolated-test
timeout: 30s
requires:
  capabilities:
    - world.block.read
given: []
when: []
then:
  - assert.block:
      position: { world_key: minecraft:overworld, x: 0, y: 64, z: 0 }
      within: 1s
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
    });

    const result = await engine.run();
    assert.equal(result.status, 'completed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.scenarioId, 'smoke-test');

    await engine.disposeRuntime();
  } finally {
    await cleanup();
  }
});

test('engine: assertion görünürlüğü — assertions listesi expected/actual/attempts/duration taşır', async () => {
  const bridge = createFakeBridge();
  const { provider } = createRecordingProvider(bridge);
  const { path, cleanup } = await writeScenario(`
version: 1
id: assertion-visibility
title: Assertion görünürlüğü
profile: isolated-test
timeout: 30s
requires:
  capabilities:
    - world.block.read
given: []
when: []
then:
  - assert.block:
      position: { world_key: minecraft:overworld, x: 0, y: 64, z: 0 }
      material: minecraft:air
      within: 2s
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
    });

    const result = await engine.run();
    assert.equal(result.status, 'completed');
    assert.equal(result.assertions.length, 1);
    const assertion = result.assertions[0]!;
    assert.equal(assertion.stepName, 'assert.block');
    assert.equal(assertion.passed, true);
    assert.equal(assertion.expected, 'minecraft:air');
    assert.equal(assertion.actual, 'minecraft:air');
    assert.ok(assertion.durationMs >= 0);
    assert.ok(assertion.attempts >= 1);
    assert.match(assertion.message, /başar/i);

    await engine.disposeRuntime();
  } finally {
    await cleanup();
  }
});

test('engine: world.set_chunk_ticket ve world.set_block action endpointinden idempotency key ile gider', async () => {
  const bridge = createFakeBridge();
  const { provider } = createRecordingProvider(bridge);
  const { path, cleanup } = await writeScenario(`
version: 1
id: world-chunk-ticket
title: Chunk ticket + blok yazma
profile: isolated-test
timeout: 30s
requires:
  capabilities:
    - world.chunk.ticket
    - world.block.write
    - world.block.read
given:
  - world.set_chunk_ticket:
      position: { world_key: minecraft:overworld, x: 40, y: 64, z: 40 }
      radius: 1
  - world.set_block:
      position: { world_key: minecraft:overworld, x: 40, y: 64, z: 40 }
      material: minecraft:chest
when: []
then:
  - assert.block:
      position: { world_key: minecraft:overworld, x: 40, y: 64, z: 40 }
      material: minecraft:chest
      within: 2s
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
    });

    const result = await engine.run();
    assert.equal(result.status, 'completed');

    const tickets = bridge.actions.filter((a) => a.operation === 'world.set_chunk_ticket');
    const writes = bridge.actions.filter((a) => a.operation === 'world.set_block');

    assert.equal(tickets.length, 1);
    assert.equal(tickets[0]!.args['world_key'], 'minecraft:overworld');
    assert.equal(tickets[0]!.args['x'], 40);
    assert.equal(tickets[0]!.args['z'], 40);
    assert.equal(tickets[0]!.args['radius'], 1);
    assert.ok(tickets[0]!.idempotencyKey, 'chunk ticket idempotency key taşımalı');

    assert.equal(writes.length, 1);
    assert.equal(writes[0]!.args['material'], 'minecraft:chest');
    assert.ok(writes[0]!.idempotencyKey, 'set_block idempotency key taşımalı');

    // Assertion world.get_block query'si ile polling yaptı
    const getBlocks = bridge.queries.filter((q) => q.operation === 'world.get_block');
    assert.ok(getBlocks.length >= 1);
    assert.equal(getBlocks[0]!.args['world_key'], 'minecraft:overworld');

    await engine.disposeRuntime();
  } finally {
    await cleanup();
  }
});

test('engine: assertion başarısız olursa scenario failed döner, runtime yine dispose edilir', async () => {
  const bridge = createFakeBridge();
  const disposeLog: string[] = [];
  const { provider } = createRecordingProvider(bridge, disposeLog);
  const { path, cleanup } = await writeScenario(`
version: 1
id: failing-assert
title: Failing assertion
profile: isolated-test
timeout: 30s
requires:
  capabilities:
    - world.block.read
given: []
when: []
then:
  - assert.block:
      position: { world_key: minecraft:overworld, x: 0, y: 64, z: 0 }
      material: minecraft:diamond
      within: 100ms
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
    });

    const result = await engine.run();
    assert.equal(result.status, 'failed');
    assert.equal(result.failed, 1);

    await engine.disposeRuntime();
    assert.deepEqual(disposeLog, ['disposed']);
  } finally {
    await cleanup();
  }
});

test('engine: parse hatası olan scenario run öncesi reddedilir, provider çağrılmaz', async () => {
  const bridge = createFakeBridge();
  const { calls, provider } = createRecordingProvider(bridge);
  const { path, cleanup } = await writeScenario(`
version: 1
id: bad-scenario
title: Disallowed step
profile: isolated-test
timeout: 30s
requires:
  capabilities:
    - world.block.read
given:
  - unknown.step: {}
when: []
then:
  - assert.block:
      position: { world_key: minecraft:overworld, x: 0, y: 64, z: 0 }
      within: 1s
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
    });

    const result = await engine.run();
    assert.equal(result.status, 'failed');
    assert.equal(calls.length, 0, 'parse hatasında runtime provision edilmemeli');
  } finally {
    await cleanup();
  }
});

// ------------------------------------------------------------ expect bloğu (DSL-12)

test('engine: EULA_NOT_ACCEPTED engine hatası errorCode olarak sonuca taşınır', async () => {
  const { path, cleanup } = await writeScenario(`
version: 1
id: eula-reject
title: EULA reddi
profile: isolated-test
timeout: 30s
requires:
  capabilities:
    - world.block.read
given: []
when: []
then:
  - assert.block:
      position: { world_key: minecraft:overworld, x: 0, y: 64, z: 0 }
      within: 1s
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: async () => {
        throw Object.assign(new Error('Minecraft EULA kabul edilmeden runtime oluşturulamaz.'), {
          code: 'EULA_NOT_ACCEPTED',
        });
      },
    });

    const result = await engine.run();
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'EULA_NOT_ACCEPTED');
    assert.equal(result.passed, 0);
    assert.equal(result.evidenceIds.length, 0);
  } finally {
    await cleanup();
  }
});

test('engine: expect failed + error_code eşleşirse scenario completed sayılır', async () => {
  const bridge = createFailingBridge('CHUNK_NOT_LOADED');
  const { provider } = createRecordingProvider(bridge);
  const { path, cleanup } = await writeScenario(`
version: 1
id: expect-chunk-error
title: Beklenen chunk hatasi
profile: isolated-test
timeout: 30s
expect:
  status: failed
  error_code: CHUNK_NOT_LOADED
given: []
when:
  - world.set_block:
      position: { world_key: minecraft:overworld, x: 40, y: 64, z: 40 }
      material: minecraft:chest
then: []
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
    });

    const result = await engine.run();
    assert.equal(result.status, 'completed', 'beklenen hata görülünce scenario completed olmalı');
    assert.equal(result.failed, 1, 'adım yine failed sayılır (kullanıcıya gerçek durum görünür)');
    assert.equal(bridge.actions.length, 1);

    await engine.disposeRuntime();
  } finally {
    await cleanup();
  }
});

test('engine: expect error_code eşleşmezse scenario failed olur', async () => {
  const bridge = createFailingBridge('REGION_NOT_ALLOWED');
  const { provider } = createRecordingProvider(bridge);
  const { path, cleanup } = await writeScenario(`
version: 1
id: expect-wrong-code
title: Yanlis beklenen hata kodu
profile: isolated-test
timeout: 30s
expect:
  status: failed
  error_code: CHUNK_NOT_LOADED
given: []
when:
  - world.set_block:
      position: { world_key: minecraft:overworld, x: 40, y: 64, z: 40 }
      material: minecraft:chest
then: []
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
    });

    const result = await engine.run();
    assert.equal(result.status, 'failed', 'beklenenden farklı kod görülünce failed');
    await engine.disposeRuntime();
  } finally {
    await cleanup();
  }
});

test('engine: expect failed ama run başarılıysa scenario failed olur', async () => {
  const bridge = createFakeBridge();
  const { provider } = createRecordingProvider(bridge);
  const { path, cleanup } = await writeScenario(`
version: 1
id: expect-not-failed
title: Hata bekleniyor ama yok
profile: isolated-test
timeout: 30s
expect:
  status: failed
  error_code: CHUNK_NOT_LOADED
given: []
when:
  - world.set_block:
      position: { world_key: minecraft:overworld, x: 0, y: 64, z: 0 }
      material: minecraft:chest
then: []
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
    });

    const result = await engine.run();
    assert.equal(result.status, 'failed', 'beklenen hata oluşmayınca failed');
    assert.equal(result.passed, 1);
    await engine.disposeRuntime();
  } finally {
    await cleanup();
  }
});

test('engine: expect completed + başarılı run completed kalır', async () => {
  const bridge = createFakeBridge();
  const { provider } = createRecordingProvider(bridge);
  const { path, cleanup } = await writeScenario(`
version: 1
id: expect-completed-run
title: Basari beklenen scenario
profile: isolated-test
timeout: 30s
expect:
  status: completed
given: []
when:
  - world.set_block:
      position: { world_key: minecraft:overworld, x: 0, y: 64, z: 0 }
      material: minecraft:chest
then:
  - assert.block:
      position: { world_key: minecraft:overworld, x: 0, y: 64, z: 0 }
      material: minecraft:chest
      within: 2s
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
    });

    const result = await engine.run();
    assert.equal(result.status, 'completed');
    await engine.disposeRuntime();
  } finally {
    await cleanup();
  }
});

// ------------------------------------------------------------ M2B: actor adımları

/** player.message event'leri döndüren bridge. */
function createMessageBridge(messages: Array<{ actor: string; message: string; cancelled?: boolean }>): FakeBridge {
  const actions: FakeBridge['actions'] = [];
  const queries: FakeBridge['queries'] = [];
  return {
    actions,
    queries,
    setBlock() {},
    async query() {
      return {};
    },
    async action(operation, args, idempotencyKey) {
      actions.push({ operation, args, idempotencyKey });
      return {};
    },
    async events() {
      return messages.map((m, i) => ({
        sequence: i + 1,
        event_id: `evt_test_${i + 1}`,
        type: 'player.message',
        bridge_boot_id: 'boot_test',
        server_instance_id: 'rimg_test',
        correlation_id: null,
        causation_id: null,
        server_tick: i + 1,
        occurred_at: '2026-08-09T00:00:00Z',
        actor: { kind: 'test_actor', id: m.actor },
        data: { message: m.message, cancelled: m.cancelled ?? false, sender: m.actor },
        source: 'paper',
      }));
    },
  };
}

/** player.get_state query'si PLAYER_NOT_FOUND fırlatan bridge (oyuncu bağlı değil). */
function createPlayerMissingBridge(): FakeBridge {
  const actions: FakeBridge['actions'] = [];
  const queries: FakeBridge['queries'] = [];
  return {
    actions,
    queries,
    setBlock() {},
    async query(operation) {
      queries.push({ operation, args: {} });
      if (operation === 'player.get_state') {
        throw new BridgeClientError('PLAYER_NOT_FOUND', 'Oyuncu bağlı değil');
      }
      return {};
    },
    async action(operation, args, idempotencyKey) {
      actions.push({ operation, args, idempotencyKey });
      return {};
    },
    async events() {
      return [];
    },
  };
}

function createActorClientBridge(actionsLog: FakeBridge['actions']) {
  const bridge: FakeBridge = {
    actions: actionsLog,
    queries: [],
    setBlock() {},
    async query() {
      return {};
    },
    async action(operation, args, idempotencyKey) {
      actionsLog.push({ operation, args, idempotencyKey });
      if (operation === 'player.get_state') {
        return { found: true, id: 'owner', uuid: '0000-0000', connected: true, gamemode: 'survival', health: 20, position: { world_key: 'minecraft:overworld', x: 0, y: 64, z: 0 } };
      }
      return { success: true };
    },
    async events() {
      return [{
        sequence: 1,
        event_id: 'evt_test_1',
        type: 'test_actor.created',
        bridge_boot_id: 'boot_test',
        server_instance_id: 'rimg_test',
        correlation_id: null,
        causation_id: null,
        server_tick: 1,
        occurred_at: '2026-08-09T00:00:00Z',
        actor: { kind: 'test_actor', id: 'owner' },
        data: { actor_id: 'owner' },
        source: 'paper',
      }];
    },
  };
  return bridge;
}

test('engine: assert.player_message gerçek capture — ring buffer player.message eşleşir', async () => {
  const bridge = createMessageBridge([
    { actor: 'owner', message: 'merhaba dünya' },
    { actor: 'intruder', message: 'selam' },
  ]);
  const { provider } = createRecordingProvider(bridge);
  const { path, cleanup } = await writeScenario(`
version: 1
id: message-capture
title: Mesaj yakalama
profile: isolated-test
timeout: 30s
requires:
  capabilities:
    - actor.message.read
given: []
when: []
then:
  - assert.player_message:
      actor: owner
      contains: dünya
      within: 2s
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
      getActorClient: () => new ActorClient(async (operation, args) => {
        return bridge.action(operation, args, undefined);
      }),
    });

    const result = await engine.run();
    assert.equal(result.status, 'completed');
    const assertion = result.assertions[0]!;
    assert.equal(assertion.passed, true);
    assert.deepEqual(assertion.actual, { message: 'merhaba dünya', cancelled: false });
    await engine.disposeRuntime();
  } finally {
    await cleanup();
  }
});

test('engine: assert.player_message eşleşme yoksa failed ve expected/actual taşır', async () => {
  const bridge = createMessageBridge([
    { actor: 'owner', message: 'merhaba' },
  ]);
  const { provider } = createRecordingProvider(bridge);
  const { path, cleanup } = await writeScenario(`
version: 1
id: message-capture-fail
title: Mesaj yakalanamadı
profile: isolated-test
timeout: 30s
requires:
  capabilities:
    - actor.message.read
given: []
when: []
then:
  - assert.player_message:
      actor: owner
      contains: bulunamayan mesaj
      within: 2s
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
      getActorClient: () => new ActorClient(async (operation, args) => {
        return bridge.action(operation, args, undefined);
      }),
    });

    const result = await engine.run();
    assert.equal(result.status, 'failed');
    const assertion = result.assertions[0]!;
    assert.equal(assertion.passed, false);
    assert.ok((assertion.expected as { contains?: string })?.contains?.includes('bulunamayan mesaj'));
    assert.equal(assertion.actual, null);
    await engine.disposeRuntime();
  } finally {
    await cleanup();
  }
});

test('engine: assert.player_state connected:false — oyuncu yoksa PASSED (doğru state)', async () => {
  const bridge = createPlayerMissingBridge();
  const { provider } = createRecordingProvider(bridge);
  const { path, cleanup } = await writeScenario(`
version: 1
id: player-state-disconnected
title: Oyuncu bağlı değil
profile: isolated-test
timeout: 30s
requires:
  capabilities:
    - player.state.read
given: []
when: []
then:
  - assert.player_state:
      actor: ghost
      connected: false
      within: 2s
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
    });

    const result = await engine.run();
    assert.equal(result.status, 'completed');
    assert.equal(result.assertions[0]!.passed, true);
    await engine.disposeRuntime();
  } finally {
    await cleanup();
  }
});

test('engine: player.get_state adımı actor client üzerinden çağrılır', async () => {
  const actions: FakeBridge['actions'] = [];
  const bridge = createActorClientBridge(actions);
  const { provider } = createRecordingProvider(bridge);
  const { path, cleanup } = await writeScenario(`
version: 1
id: player-get-state-step
title: Actor durumu okunur
profile: isolated-test
timeout: 30s
requires:
  capabilities:
    - player.state.read
given:
  - player.get_state:
      actor: owner
when: []
then:
  - assert.event:
      type: test_actor.created
      actor: owner
      within: 2s
cleanup: []
`);

  try {
    const engine = new ScenarioEngine({
      repoRoot: '.',
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
      getActorClient: () => new ActorClient(async (operation, args) => {
        return bridge.action(operation, args, undefined);
      }),
    });

    const result = await engine.run();
    assert.equal(result.status, 'completed');
    const getStateCall = actions.find((a) => a.operation === 'player.get_state');
    assert.ok(getStateCall, 'player.get_state çağrılmalı');
    assert.equal(getStateCall!.args['actor_id'], 'owner');
    await engine.disposeRuntime();
  } finally {
    await cleanup();
  }
});
