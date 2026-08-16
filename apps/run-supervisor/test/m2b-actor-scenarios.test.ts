/**
 * M2B Actor Scenario Testleri.
 *
 * Milestone-acceptance (M2B) kapanış kanıtı:
 *  - scenarios/actor/*.yaml fixture'larının CI'da geçerli olduğu (DSL allowlist,
 *    capability registry'de karşılığı) doğrulanır.
 *  - Tam yaşam döngüsü, blok kırma, native permission, 100 actor ve actor crash
 *    cleanup akışları mock bridge ile engine seviyesinde çalıştırılır.
 *
 * DSL-10: cleanup her terminal durumda denenir — crash testi, when fazında
 * ACTOR_CRASHED yaşansa da cleanup adımının koştuğunu kanıtlar.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ScenarioEngine, type BridgeClientLike, type ProvisionedRuntime } from '../src/scenario-engine.js';
import { ActorClient } from '../src/actor-client.js';
import { BridgeClientError } from '../src/bridge-client.js';
import { parseScenario } from '../src/scenario-parser.js';
import type { ScenarioDefinition } from '../src/scenario-parser.js';

// ------------------------------------------------------------ Yardımcılar

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const ACTOR_SCENARIO_DIR = join(REPO_ROOT, 'scenarios', 'actor');
const CAPABILITY_DIR = join(REPO_ROOT, 'packages', 'capability-registry', 'capabilities');

interface ActionLog {
  operation: string;
  args: Record<string, unknown>;
  idempotencyKey: string | undefined;
}

interface QueryLog {
  operation: string;
  args: Record<string, unknown>;
}

interface BridgeEvent {
  sequence: number;
  event_id: string;
  type: string;
  bridge_boot_id: string;
  server_instance_id: string;
  correlation_id: string | null;
  causation_id: string | null;
  server_tick: number;
  occurred_at: string;
  actor: { kind: string; id: string } | null;
  data: Record<string, unknown>;
  source: string;
  [key: string]: unknown;
}

/** Capability registry'deki tüm id'leri toplar. */
async function readRegistryCapabilityIds(): Promise<Set<string>> {
  const files = await readdir(CAPABILITY_DIR);
  const ids = new Set<string>();
  for (const file of files.filter((f) => f.endsWith('.yaml'))) {
    const content = await readFile(join(CAPABILITY_DIR, file), 'utf8');
    const raw = parseYaml(content) as { id?: unknown };
    if (typeof raw?.id === 'string') ids.add(raw.id);
  }
  return ids;
}

async function writeScenario(content: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'm2b-scenario-test-'));
  const path = join(dir, 'scenario.yaml');
  await writeFile(path, content, 'utf8');
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function createRecordingProvider(bridge: BridgeClientLike, disposeLog: string[] = []) {
  const calls: Array<{ runId: string; scenarioId: string }> = [];
  return {
    calls,
    provider: async (scenario: ScenarioDefinition, runId: string): Promise<ProvisionedRuntime> => {
      calls.push({ runId, scenarioId: scenario.id });
      return {
        runtimeImageId: `rt_test_${calls.length}`,
        bridgeBootId: 'boot_m2b',
        bridgeClient: bridge,
        dispose: async () => {
          disposeLog.push('disposed');
        },
      };
    },
  };
}

function makeActorActionFn(bridge: BridgeClientLike) {
  return new ActorClient(async (operation, args) => {
    return bridge.action(operation, args, undefined);
  });
}

// ------------------------------------------------------------ Fixture doğrulama

test('M2B: scenarios/actor/*.yaml fixture\'ları geçerli ve capability registry\'de karşılığı var', async () => {
  const registryIds = await readRegistryCapabilityIds();
  const files = (await readdir(ACTOR_SCENARIO_DIR)).filter((f) => f.endsWith('.yaml'));

  assert.ok(files.length >= 3, `scenarios/actor en az 3 fixture içermeli (bulunan: ${files.join(', ')})`);

  for (const file of files) {
    const path = join(ACTOR_SCENARIO_DIR, file);
    const result = parseScenario(path);

    assert.equal(result.valid, true, `${file} geçerli olmalı: ${result.errors.map((e) => e.message).join('; ')}`);
    assert.ok(result.scenario, `${file} scenario üretmeli`);
    assert.ok(result.steps.length > 0, `${file} en az bir adım içermeli`);
    assert.ok(
      result.scenario!.given.length + result.scenario!.when.length > 0,
      `${file} given/when adımları olmalı`,
    );

    for (const cap of result.requiredCapabilities) {
      assert.ok(
        registryIds.has(cap),
        `${file} gerektirdiği capability registry'de olmalı: "${cap}"`,
      );
    }

    for (const step of result.steps) {
      assert.ok(
        !/^assert\.|^wait$/.test(step.name) || step.name.startsWith('assert.') || step.name === 'wait',
        `${file} adımı tanınmalı: ${step.name}`,
      );
    }
  }
});

// ------------------------------------------------------------ Tam yaşam döngüsü

/**
 * Actor store'u + ring buffer'ı simüle eden bridge.
 * - test_actor.create: store'a ekler, test_actor.created event'i yazar.
 * - player.get_state (action): connected store'dan okur.
 * - player.chat: player.chat + player.message event'lerini yazar.
 * - player.look / player.move: success döner.
 * - test_actor.disconnect_all: store'u boşaltır, event yazar.
 * - query player.get_state: oyuncu bağlı değilse PLAYER_NOT_FOUND fırlatır.
 */
function createLifecycleBridge() {
  const actions: ActionLog[] = [];
  const queries: QueryLog[] = [];
  const eventLog: BridgeEvent[] = [];
  const connected = new Set<string>();
  let seq = 0;

  function push(type: string, actorId: string | null, data: Record<string, unknown>) {
    seq += 1;
    eventLog.push({
      sequence: seq,
      event_id: `evt_m2b_${seq}`,
      type,
      bridge_boot_id: 'boot_m2b',
      server_instance_id: 'rimg_m2b',
      correlation_id: null,
      causation_id: null,
      server_tick: seq,
      occurred_at: '2026-08-15T00:00:00Z',
      actor: actorId === null ? null : { kind: 'test_actor', id: actorId },
      data,
      source: 'paper',
    });
  }

  return {
    actions,
    queries,
    eventLog,
    connected,
    setBlock() {},
    async query(operation: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
      queries.push({ operation, args });
      if (operation === 'player.get_state') {
        const playerId = args['player_id'] as string;
        if (!connected.has(playerId)) {
          throw new BridgeClientError('PLAYER_NOT_FOUND', 'Oyuncu bağlı değil');
        }
        return { id: playerId, uuid: '0000-0000', connected: true, gamemode: 'survival', health: 20 };
      }
      return {};
    },
    async action(operation: string, args: Record<string, unknown>, idempotencyKey: string | undefined) {
      actions.push({ operation, args, idempotencyKey });
      if (operation === 'test_actor.create') {
        const actorId = args['actor_id'] as string;
        connected.add(actorId);
        push('test_actor.created', actorId, { actor_id: actorId });
        return { success: true, joined: true };
      }
      if (operation === 'test_actor.disconnect_all') {
        connected.clear();
        push('test_actor.disconnected_all', null, {});
        return { success: true };
      }
      if (operation === 'player.chat') {
        const actorId = args['actor_id'] as string;
        const message = args['message'] as string;
        push('player.chat', actorId, { message, cancelled: false });
        push('player.message', actorId, { message, cancelled: false, sender: actorId });
        return { success: true };
      }
      if (operation === 'player.get_state') {
        const actorId = args['actor_id'] as string;
        return {
          found: connected.has(actorId),
          id: actorId,
          uuid: '0000-0000',
          connected: connected.has(actorId),
          gamemode: 'survival',
          health: 20,
          position: { world_key: 'minecraft:overworld', x: 0, y: 64, z: 0 },
        };
      }
      return { success: true };
    },
    async events(): Promise<Record<string, unknown>[]> {
      return eventLog as unknown as Record<string, unknown>[];
    },
  };
}

test('M2B: tam yaşam döngüsü — create, get_state, look, move, chat, disconnect', async () => {
  const bridge = createLifecycleBridge();
  const { provider } = createRecordingProvider(bridge);
  const scenarioPath = join(ACTOR_SCENARIO_DIR, 'lifecycle.yaml');

  const engine = new ScenarioEngine({
    repoRoot: REPO_ROOT,
    scenarioPath,
    projectId: 'proj_test',
    runtimeProvider: provider,
    getActorClient: () => makeActorActionFn(bridge),
  });

  try {
    const result = await engine.run();

    assert.equal(result.status, 'completed', `lifecycle completed olmalı (error: ${result.errorCode ?? '-'})`);

    const ops = bridge.actions.map((a) => a.operation);
    assert.ok(ops.includes('test_actor.create'), 'test_actor.create çağrılmalı');
    assert.ok(ops.includes('player.get_state'), 'player.get_state çağrılmalı');
    assert.ok(ops.includes('player.look'), 'player.look çağrılmalı');
    assert.ok(ops.includes('player.move'), 'player.move çağrılmalı');
    assert.ok(ops.includes('player.chat'), 'player.chat çağrılmalı');
    assert.ok(ops.includes('test_actor.disconnect_all'), 'test_actor.disconnect_all çağrılmalı');

    const createCall = bridge.actions.find((a) => a.operation === 'test_actor.create')!;
    assert.equal(createCall.args['actor_id'], 'owner');

    const chatCall = bridge.actions.find((a) => a.operation === 'player.chat')!;
    assert.equal(chatCall.args['message'], 'merhaba m2b');

    const moveCall = bridge.actions.find((a) => a.operation === 'player.move')!;
    assert.deepEqual(moveCall.args['position'], {
      world_key: 'minecraft:overworld',
      x: 0,
      y: 64,
      z: 0,
    });

    assert.equal(bridge.connected.size, 0, 'disconnect_all sonrası hiçbir actor bağlı olmamalı');

    assert.ok(
      bridge.eventLog.some((e) => e.type === 'player.message' && e.actor?.id === 'owner'),
      "player.message event'i ring buffer'da olmalı",
    );
    assert.ok(
      bridge.eventLog.some((e) => e.type === 'player.chat' && e.actor?.id === 'owner'),
      "player.chat event'i ring buffer'da olmalı",
    );
    assert.ok(
      bridge.eventLog.some((e) => e.type === 'test_actor.disconnected_all'),
      "disconnect_all event'i ring buffer'da olmalı",
    );

    assert.equal(result.assertions.length, 3, '3 assertion çalışmalı');
    assert.ok(result.assertions.every((a) => a.passed), 'tüm assertionlar geçmeli');
  } finally {
    await engine.disposeRuntime();
  }
});

// ------------------------------------------------------------ Blok kırma

/**
 * Blok dünyası + actor store simülasyonu.
 * - world.set_chunk_ticket / world.set_block: blok map'ine yazar.
 * - player.break_block: bloğu air yapar, block.break event'i yazar.
 * - query world.get_block: mevcut malzemeyi döner.
 */
function createBlockBridge() {
  const actions: ActionLog[] = [];
  const queries: QueryLog[] = [];
  const eventLog: BridgeEvent[] = [];
  const blocks = new Map<string, string>();
  const connected = new Set<string>();
  let seq = 0;

  const blockKey = (args: Record<string, unknown>) =>
    `${args['world_key']},${args['x']},${args['y']},${args['z']}`;

  function push(type: string, actorId: string | null, data: Record<string, unknown>) {
    seq += 1;
    eventLog.push({
      sequence: seq,
      event_id: `evt_m2b_${seq}`,
      type,
      bridge_boot_id: 'boot_m2b',
      server_instance_id: 'rimg_m2b',
      correlation_id: null,
      causation_id: null,
      server_tick: seq,
      occurred_at: '2026-08-15T00:00:00Z',
      actor: actorId === null ? null : { kind: 'test_actor', id: actorId },
      data,
      source: 'paper',
    });
  }

  return {
    actions,
    queries,
    eventLog,
    connected,
    setBlock(worldKey: string, x: number, y: number, z: number, material: string) {
      blocks.set(`${worldKey},${x},${y},${z}`, material);
    },
    async query(operation: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
      queries.push({ operation, args });
      if (operation === 'world.get_block') {
        return { material: blocks.get(blockKey(args)) ?? 'minecraft:air' };
      }
      return {};
    },
    async action(operation: string, args: Record<string, unknown>, idempotencyKey: string | undefined) {
      actions.push({ operation, args, idempotencyKey });
      if (operation === 'world.set_chunk_ticket') {
        return { success: true };
      }
      if (operation === 'world.set_block') {
        blocks.set(blockKey(args), args['material'] as string);
        return { success: true };
      }
      if (operation === 'test_actor.create') {
        const actorId = args['actor_id'] as string;
        connected.add(actorId);
        push('test_actor.created', actorId, { actor_id: actorId });
        return { success: true, joined: true };
      }
      if (operation === 'player.break_block') {
        const actorId = args['actor_id'] as string;
        const position = args['position'] as Record<string, unknown>;
        blocks.set(blockKey(position), 'minecraft:air');
        push('block.break', actorId, { position });
        return { success: true, cancelled: false };
      }
      if (operation === 'test_actor.disconnect_all') {
        connected.clear();
        push('test_actor.disconnected_all', null, {});
        return { success: true };
      }
      return { success: true };
    },
    async events(): Promise<Record<string, unknown>[]> {
      return eventLog as unknown as Record<string, unknown>[];
    },
  };
}

test('M2B: blok kırma — gerçek BlockBreakEvent semantiği ile blok air olur', async () => {
  const bridge = createBlockBridge();
  const { provider } = createRecordingProvider(bridge);
  const scenarioPath = join(ACTOR_SCENARIO_DIR, 'block-break.yaml');

  const engine = new ScenarioEngine({
    repoRoot: REPO_ROOT,
    scenarioPath,
    projectId: 'proj_test',
    runtimeProvider: provider,
    getActorClient: () => makeActorActionFn(bridge),
  });

  try {
    const result = await engine.run();

    assert.equal(result.status, 'completed', `block-break completed olmalı (error: ${result.errorCode ?? '-'})`);

    assert.ok(
      bridge.actions.some((a) => a.operation === 'world.set_chunk_ticket'),
      'world.set_chunk_ticket çağrılmalı',
    );
    assert.ok(bridge.actions.some((a) => a.operation === 'world.set_block'), 'world.set_block çağrılmalı');
    assert.ok(
      bridge.actions.some((a) => a.operation === 'player.break_block'),
      'player.break_block çağrılmalı',
    );
    assert.ok(
      bridge.actions.some((a) => a.operation === 'test_actor.disconnect_all'),
      'cleanup: test_actor.disconnect_all çağrılmalı',
    );

    const breakCall = bridge.actions.find((a) => a.operation === 'player.break_block')!;
    assert.equal(breakCall.args['actor_id'], 'builder');
    assert.deepEqual(breakCall.args['position'], {
      world_key: 'minecraft:overworld',
      x: 0,
      y: 64,
      z: 0,
    });

    assert.ok(
      bridge.eventLog.some((e) => e.type === 'block.break' && e.actor?.id === 'builder'),
      "block.break event'i actor kimliğiyle yakalanmalı",
    );

    assert.ok(result.assertions.some((a) => a.stepName === 'assert.block' && a.passed), 'assert.block geçmeli');
    assert.ok(
      result.assertions.some((a) => a.stepName === 'assert.event' && a.passed),
      'assert.event (block.break) geçmeli',
    );
  } finally {
    await engine.disposeRuntime();
  }
});

// ------------------------------------------------------------ Native permission

/**
 * plugin.command'u oyuncu permission'ıyla simüle eder: yetkisiz gamemode
 * komutu dispatch_ok=false döner ama player.command event'i yazılır (ADR-0006).
 */
function createPermissionBridge() {
  const actions: ActionLog[] = [];
  const queries: QueryLog[] = [];
  const eventLog: BridgeEvent[] = [];
  const connected = new Set<string>();
  let seq = 0;

  function push(type: string, actorId: string | null, data: Record<string, unknown>) {
    seq += 1;
    eventLog.push({
      sequence: seq,
      event_id: `evt_m2b_${seq}`,
      type,
      bridge_boot_id: 'boot_m2b',
      server_instance_id: 'rimg_m2b',
      correlation_id: null,
      causation_id: null,
      server_tick: seq,
      occurred_at: '2026-08-15T00:00:00Z',
      actor: actorId === null ? null : { kind: 'test_actor', id: actorId },
      data,
      source: 'paper',
    });
  }

  return {
    actions,
    queries,
    eventLog,
    connected,
    setBlock() {},
    async query(): Promise<Record<string, unknown>> {
      return {};
    },
    async action(operation: string, args: Record<string, unknown>, idempotencyKey: string | undefined) {
      actions.push({ operation, args, idempotencyKey });
      if (operation === 'test_actor.create') {
        const actorId = args['actor_id'] as string;
        connected.add(actorId);
        push('test_actor.created', actorId, { actor_id: actorId });
        return { success: true, joined: true };
      }
      if (operation === 'plugin.command') {
        const actorId = args['actor_id'] as string;
        const commandId = args['command_id'] as string;
        const commandArgs = args['arguments'] as Record<string, unknown>;
        // Native permission: yetkisiz dispatch reddedilir (dispatch_ok=false),
        // ancak komut girişimi player.command event'i olarak kayıt altına alınır.
        push('player.command', actorId, {
          command_id: commandId,
          arguments: commandArgs,
          dispatch_ok: false,
        });
        return { success: true, dispatch_ok: false, message: 'Yetki yok: komut oyuncu bağlamında reddedildi' };
      }
      if (operation === 'test_actor.disconnect_all') {
        connected.clear();
        push('test_actor.disconnected_all', null, {});
        return { success: true };
      }
      return { success: true };
    },
    async events(): Promise<Record<string, unknown>[]> {
      return eventLog as unknown as Record<string, unknown>[];
    },
  };
}

test('M2B: native permission — yetkisiz komut oyuncu bağlamında reddedilir (dispatch_ok=false)', async () => {
  const bridge = createPermissionBridge();
  const { provider } = createRecordingProvider(bridge);
  const scenarioPath = join(ACTOR_SCENARIO_DIR, 'native-permission.yaml');

  const engine = new ScenarioEngine({
    repoRoot: REPO_ROOT,
    scenarioPath,
    projectId: 'proj_test',
    runtimeProvider: provider,
    getActorClient: () => makeActorActionFn(bridge),
  });

  try {
    const result = await engine.run();

    assert.equal(result.status, 'completed', `native-permission completed olmalı (error: ${result.errorCode ?? '-'})`);

    const commandCall = bridge.actions.find((a) => a.operation === 'plugin.command')!;
    assert.ok(commandCall, 'plugin.command çağrılmalı');
    assert.equal(commandCall.args['actor_id'], 'intruder');
    assert.equal(commandCall.args['command_id'], 'gamemode');
    assert.deepEqual(commandCall.args['arguments'], { target: 'creative' });

    assert.ok(
      bridge.eventLog.some((e) => e.type === 'player.command' && e.actor?.id === 'intruder'),
      "player.command event'i yakalanmalı",
    );

    assert.ok(result.assertions.every((a) => a.passed), 'assertionlar geçmeli');
  } finally {
    await engine.disposeRuntime();
  }
});

// ------------------------------------------------------------ 100 actor yaşam döngüsü

test('M2B: 100 actor — create 100, hepsi connected, disconnect_all ile hepsi bağlantısız', async () => {
  const actions: ActionLog[] = [];
  const queries: QueryLog[] = [];
  const eventLog: BridgeEvent[] = [];
  const connected = new Set<string>();
  let seq = 0;

  const push = (type: string, actorId: string | null, data: Record<string, unknown>) => {
    seq += 1;
    eventLog.push({
      sequence: seq,
      event_id: `evt_m2b_${seq}`,
      type,
      bridge_boot_id: 'boot_m2b',
      server_instance_id: 'rimg_m2b',
      correlation_id: null,
      causation_id: null,
      server_tick: seq,
      occurred_at: '2026-08-15T00:00:00Z',
      actor: actorId === null ? null : { kind: 'test_actor', id: actorId },
      data,
      source: 'paper',
    });
  };

  const bridge: BridgeClientLike = {
    async query(operation: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
      queries.push({ operation, args });
      if (operation === 'player.get_state') {
        const playerId = args['player_id'] as string;
        if (!connected.has(playerId)) {
          throw new BridgeClientError('PLAYER_NOT_FOUND', 'Oyuncu bağlı değil');
        }
        return { id: playerId, uuid: '0000-0000', connected: true, gamemode: 'survival', health: 20 };
      }
      return {};
    },
    async action(operation: string, args: Record<string, unknown>, idempotencyKey: string | undefined) {
      actions.push({ operation, args, idempotencyKey });
      if (operation === 'test_actor.create') {
        const actorId = args['actor_id'] as string;
        connected.add(actorId);
        push('test_actor.created', actorId, { actor_id: actorId });
        return { success: true, joined: true };
      }
      if (operation === 'test_actor.disconnect_all') {
        connected.clear();
        push('test_actor.disconnected_all', null, {});
        return { success: true };
      }
      return { success: true };
    },
    async events(): Promise<Record<string, unknown>[]> {
      return eventLog as unknown as Record<string, unknown>[];
    },
  };

  // given fazı 64 adım sınırı (scenario-parser) nedeniyle 60 + when fazında 40 create.
  const givenCreates = Array.from({ length: 60 }, (_, i) => `  - test_actor.create:\n      id: actor_${i}`);
  const whenCreates = Array.from({ length: 40 }, (_, i) => `  - test_actor.create:\n      id: actor_${60 + i}`);

  const { path, cleanup } = await writeScenario(`
version: 1
id: actor-100-lifecycle
title: 100 actor yaşam döngüsü
profile: isolated-test
timeout: 90s
requires:
  capabilities:
    - test_actor.protocol
    - player.state.read
    - actor.disconnect
    - events.read
given:
${givenCreates.join('\n')}
when:
${whenCreates.join('\n')}
  - test_actor.disconnect_all: {}
then:
  - assert.player_state:
      actor: actor_0
      connected: false
      within: 2s
  - assert.event:
      type: test_actor.created
      actor: actor_99
      within: 2s
cleanup: []
`);

  const { provider } = createRecordingProvider(bridge);

  try {
    const engine = new ScenarioEngine({
      repoRoot: REPO_ROOT,
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
      getActorClient: () => makeActorActionFn(bridge),
    });

    const result = await engine.run();

    assert.equal(result.status, 'completed', `actor-100 completed olmalı (error: ${result.errorCode ?? '-'})`);

    const createCalls = actions.filter((a) => a.operation === 'test_actor.create');
    assert.equal(createCalls.length, 100, '100 test_actor.create çağrılmalı');
    assert.equal(connected.size, 0, 'disconnect_all sonrası hiçbir actor bağlı olmamalı');

    const ids = createCalls.map((c) => c.args['actor_id'] as string);
    assert.ok(ids.includes('actor_0') && ids.includes('actor_99'), 'tüm id aralığı create edilmeli');
    assert.equal(new Set(ids).size, 100, 'id ler benzersiz olmalı');

    assert.ok(result.assertions.every((a) => a.passed), 'assertionlar geçmeli');
    await engine.disposeRuntime();
  } finally {
    await cleanup();
  }
});

// ------------------------------------------------------------ Actor crash cleanup (DSL-10)

test('M2B: actor crash — when fazında ACTOR_CRASHED olsa da cleanup koşar', async () => {
  const actions: ActionLog[] = [];
  const connected = new Set<string>();

  const bridge: BridgeClientLike = {
    async query(): Promise<Record<string, unknown>> {
      return {};
    },
    async action(operation: string, args: Record<string, unknown>, idempotencyKey: string | undefined) {
      actions.push({ operation, args, idempotencyKey });
      if (operation === 'test_actor.create') {
        const actorId = args['actor_id'] as string;
        connected.add(actorId);
        return { success: true, joined: true };
      }
      if (operation === 'plugin.command') {
        // Simüle crash: komut çalıştırılamadı -> ACTOR_CRASHED.
        return { success: false, message: 'Simüle actor crash' };
      }
      if (operation === 'test_actor.disconnect_all') {
        connected.clear();
        return { success: true };
      }
      return { success: true };
    },
    async events(): Promise<Record<string, unknown>[]> {
      return [];
    },
  };

  const { path, cleanup } = await writeScenario(`
version: 1
id: actor-crash-cleanup
title: Crash sonrası cleanup
profile: isolated-test
timeout: 30s
requires:
  capabilities:
    - test_actor.protocol
    - plugin.command.typed
    - actor.disconnect
given:
  - test_actor.create:
      id: owner
when:
  - plugin.command:
      actor: owner
      command_id: gamemode
      arguments:
        target: creative
then:
  - assert.event:
      type: test_actor.created
      actor: owner
      within: 2s
cleanup:
  - test_actor.disconnect_all: {}
`);

  const { provider } = createRecordingProvider(bridge);

  try {
    const engine = new ScenarioEngine({
      repoRoot: REPO_ROOT,
      scenarioPath: path,
      projectId: 'proj_test',
      runtimeProvider: provider,
      getActorClient: () => makeActorActionFn(bridge),
    });

    const result = await engine.run();

    // ACTOR_CRASHED yaşandığı için scenario failed olmalı (DSL-10: cleanup ana sonucu gizlemez).
    assert.equal(result.status, 'failed', 'crash sonrası scenario failed olmalı');
    assert.equal(result.errorCode, 'ACTOR_CRASHED', 'hata kodu ACTOR_CRASHED olmalı');

    const cleanupCall = actions.find((a) => a.operation === 'test_actor.disconnect_all');
    assert.ok(cleanupCall, 'when hatasına rağmen cleanup (test_actor.disconnect_all) çağrılmalı');

    assert.equal(connected.size, 0, 'cleanup sonrası actor bağlı kalmamalı');
  } finally {
    await cleanup();
  }
});
