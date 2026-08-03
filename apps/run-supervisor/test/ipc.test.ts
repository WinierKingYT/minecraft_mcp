/**
 * CT-IPC-001 — Supervisor IPC sözleşmesi.
 *
 * Gerçek Paper GEREKTİRMEZ: handler'lar sahtedir. Amaç, protokol sınırlarını
 * kilitlemek — token doğrulaması, bilinmeyen metot reddi, çerçeve boyutu ve
 * hata eşlemesi.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  NdjsonDecoder,
  FrameTooLargeError,
  encodeFrame,
  IPC_MAX_MESSAGE_BYTES,
  type IpcMethod,
  type IpcResponse,
  type RuntimeSummary,
} from '@mcpdev/contracts';
import { SupervisorIpcServer, toIpcError, type MethodHandler } from '../src/ipc-server.js';

const TOKEN = 'a'.repeat(64);

function endpointPath(): string {
  const id = randomBytes(6).toString('hex');
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\mcpdev-test-${id}`
    : join(tmpdir(), `mcpdev-test-${id}.sock`);
}

function stubHandlers(overrides: Partial<Record<IpcMethod, MethodHandler>> = {}): Record<IpcMethod, MethodHandler> {
  const base: Record<IpcMethod, MethodHandler> = {
    'supervisor.health': async () => ({ status: 'ok', runtimeCount: 0 }),
    'runtime.create': async () => ({ runtimeImageId: 'rimg_test' }),
    'runtime.launch': async () => ({ state: 'READY' }),
    'runtime.get': async () => ({ state: 'CREATED' }),
    'runtime.stop': async () => ({ graceful: true }),
    'runtime.release': async () => ({ state: 'RELEASED' }),
    'bridge.query': async () => ({ paper_version: '26.2' }),
    'bridge.events': async () => ({ events: [] }),
    'project.inspect': async () => ({ projectId: 'test', rootPath: '/test', trustLevel: 'developer-workspace', gradleWrapper: { found: true, jarExists: true, propertiesExists: true }, pluginMetadata: null, testContract: { found: false } }),
    'project.validate': async () => ({ projectId: 'test', findings: [], gradleVersion: null, javaMajor: null, distributionSha256Valid: null, lockFilePresent: false, verificationMetadataPresent: false }),
    'build.run': async () => ({ buildId: 'build_test', projectId: 'test', mode: 'build', status: 'completed', durationMs: 0, evidenceIds: [] }),
    'plugin.diagnose': async () => ({ type: 'build', summary: 'test', errors: [], failedTasks: [], warnings: [] }),
    'scenario.run': async () => ({ scenarioRunId: 'sr_test', status: 'completed', passed: 0, failed: 0, skipped: 0, durationMs: 0, evidenceIds: [] }),
    'evidence.get': async () => ({ evidenceId: 'ev_test', kind: 'build-log', producer: { component: 'run-supervisor', version: '0.1.0' }, content: {}, byteSize: 0, checksum: 'abc', createdAt: new Date().toISOString() }),
    'events.subscribe': async () => ({ subscriptionId: 'sub_test', status: 'active', eventsReceived: 0 }),
    'events.unsubscribe': async () => ({ subscriptionId: 'sub_test', status: 'unsubscribed', eventsReceived: 0 }),
    'events.list': async () => ({ subscriptionId: 'sub_test', events: [], hasMore: false, nextCursor: null }),
    'pool.status': async () => ({ total: 0, idle: 0, acquired: 0, evicted: 0, expired: 0, maxPoolSize: 5, maxIdleMs: 300_000, maxReuseCount: 10 }),
    'pool.acquire': async () => {
      const mockSummary: RuntimeSummary = {
        runtimeImageId: 'rimg_test',
        serverInstanceId: 'srv_test',
        state: 'READY',
        bridgeBootId: 'boot_test',
        bridgePort: 8080,
        paperJarSha256: 'sha',
        bridgeJarSha256: 'sha',
        createdAt: new Date().toISOString(),
        readyGateMs: 1000,
      };
      return { poolId: 'pool_test', runtimeSummary: mockSummary };
    },
    'pool.release': async () => ({ poolId: 'pool_test', evicted: false }),
    'pool.evict': async () => ({ poolId: 'pool_test' }),
    'pool.list': async () => ({ entries: [] }),
    'pool.reset': async () => ({ evictedCount: 0 }),
    'profile.list': async () => ({ profiles: [], activeProfileId: 'paper-26.2-build-84-v1' }),
    'profile.get': async () => ({ id: 'paper-26.2-build-84-v1', status: 'active', minecraftVersion: '26.2', paperBuild: 84, verificationStatus: 'verified', javaVersion: 25, nodeVersion: '24.18.1', gradleVersion: '9.6.1' }),
    'permission.attach': async () => ({ attachmentId: 'perm_test', playerName: 'p', permission: 'p', value: true, createdAt: 0, expiresAt: null }),
    'permission.detach': async () => ({ success: true }),
    'permission.check': async () => ({ player: 'p', permission: 'p', hasPermission: false, source: 'default' }),
    'permission.set_op': async () => ({ success: true }),
  };
  return { ...base, ...overrides };
}

/** Tek bir istek gönderip tek yanıt bekleyen minimal istemci. */
async function roundTrip(path: string, message: unknown): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    const decoder = new NdjsonDecoder(IPC_MAX_MESSAGE_BYTES);
    socket.setEncoding('utf8');

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('IPC yanıtı gelmedi'));
    }, 5000);

    socket.on('connect', () => socket.write(JSON.stringify(message) + '\n'));
    socket.on('data', (chunk: string) => {
      for (const line of decoder.push(chunk)) {
        clearTimeout(timer);
        socket.destroy();
        resolve(JSON.parse(line) as IpcResponse);
        return;
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function withServer(
  handlers: Record<IpcMethod, MethodHandler>,
  run: (path: string) => Promise<void>,
): Promise<void> {
  const path = endpointPath();
  const server = new SupervisorIpcServer({ endpointPath: path, token: TOKEN, handlers });
  await server.listen();
  try {
    await run(path);
  } finally {
    await server.close();
  }
}

test('geçerli token ile metot çağrılır', async () => {
  await withServer(stubHandlers(), async (path) => {
    const res = await roundTrip(path, { v: 1, id: '1', method: 'supervisor.health', params: {}, token: TOKEN });

    assert.equal(res.ok, true);
    assert.deepEqual(res.ok === true ? res.result : null, { status: 'ok', runtimeCount: 0 });
  });
});

test('yanlış token reddedilir', async () => {
  await withServer(stubHandlers(), async (path) => {
    const res = await roundTrip(path, { v: 1, id: '1', method: 'supervisor.health', params: {}, token: 'b'.repeat(64) });

    assert.equal(res.ok, false);
    assert.equal(res.ok === false ? res.error.code : null, 'BRIDGE_UNAUTHORIZED');
  });
});

test('doğru önek yeterli değildir', async () => {
  // Sabit süreli karşılaştırmanın davranışsal kanıtı.
  await withServer(stubHandlers(), async (path) => {
    const res = await roundTrip(path, {
      v: 1,
      id: '1',
      method: 'supervisor.health',
      params: {},
      token: TOKEN.slice(0, -1) + 'b',
    });
    assert.equal(res.ok, false);
  });
});

test('token her istekte aranır', async () => {
  await withServer(stubHandlers(), async (path) => {
    const res = await roundTrip(path, { v: 1, id: '1', method: 'supervisor.health', params: {} });
    assert.equal(res.ok, false);
    assert.equal(res.ok === false ? res.error.code : null, 'BRIDGE_UNAUTHORIZED');
  });
});

test('bilinmeyen metot reddedilir', async () => {
  await withServer(stubHandlers(), async (path) => {
    const res = await roundTrip(path, { v: 1, id: '1', method: 'runtime.destroy_everything', params: {}, token: TOKEN });

    assert.equal(res.ok, false);
    assert.equal(res.ok === false ? res.error.code : null, 'UNKNOWN_TOOL');
  });
});

test('desteklenmeyen protokol sürümü reddedilir', async () => {
  await withServer(stubHandlers(), async (path) => {
    const res = await roundTrip(path, { v: 2, id: '1', method: 'supervisor.health', params: {}, token: TOKEN });

    assert.equal(res.ok, false);
    assert.equal(res.ok === false ? res.error.code : null, 'IPC_VERSION_UNSUPPORTED');
  });
});

test('bozuk JSON çerçevesi açık hata döndürür', async () => {
  await withServer(stubHandlers(), async (path) => {
    const res = await new Promise<IpcResponse>((resolve, reject) => {
      const socket = connect(path);
      const decoder = new NdjsonDecoder(IPC_MAX_MESSAGE_BYTES);
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write('{ bozuk json\n'));
      socket.on('data', (chunk: string) => {
        for (const line of decoder.push(chunk)) {
          socket.destroy();
          resolve(JSON.parse(line) as IpcResponse);
          return;
        }
      });
      socket.on('error', reject);
    });

    assert.equal(res.ok, false);
    assert.equal(res.ok === false ? res.error.code : null, 'TOOL_INPUT_INVALID');
  });
});

test('handler hatası error catalog koduyla eşlenir', async () => {
  const handlers = stubHandlers({
    'runtime.launch': async () => {
      throw Object.assign(new Error('runtime çalışmıyor'), { code: 'RUNTIME_NOT_RUNNING' });
    },
  });

  await withServer(handlers, async (path) => {
    const res = await roundTrip(path, { v: 1, id: '9', method: 'runtime.launch', params: {}, token: TOKEN });

    assert.equal(res.ok, false);
    if (res.ok === false) {
      assert.equal(res.error.code, 'RUNTIME_NOT_RUNNING');
      assert.ok(res.error.suggested_action.length >= 8, 'KPI-08: önerilen aksiyon zorunlu');
    }
  });
});

test('kodsuz hata güvenli varsayılana düşer', () => {
  const error = toIpcError(new Error('beklenmedik'));

  assert.equal(error.code, 'SUPERVISOR_INTERNAL_ERROR');
  assert.equal(error.retryable, false);
  assert.ok(error.suggested_action.length >= 8);
});

test('NDJSON çözücü sınırı aşan çerçeveyi reddeder', () => {
  const decoder = new NdjsonDecoder(64);

  // Sınır kontrolü satır TAMAMLANMADAN önce çalışmalı; aksi hâlde sonsuz bir
  // satır göndererek sınır atlatılabilirdi.
  assert.throws(() => decoder.push('x'.repeat(65)), FrameTooLargeError);
  assert.equal(decoder.pending, 0, 'reddedilen çerçeve tamponda birikmemeli');
});

test('NDJSON çözücü yarım satırı bir sonraki parçaya taşır', () => {
  const decoder = new NdjsonDecoder(1024);

  assert.deepEqual(decoder.push('{"a":1}\n{"b'), ['{"a":1}']);
  assert.deepEqual(decoder.push('":2}\n'), ['{"b":2}']);
});

test('encodeFrame sınırı aşan mesajı reddeder', () => {
  assert.throws(() => encodeFrame({ payload: 'x'.repeat(100) }, 32), FrameTooLargeError);
});
