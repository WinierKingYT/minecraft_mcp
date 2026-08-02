/**
 * CT-ERROR-FIDELITY-001 — hata kodları sınırları geçerken korunur.
 *
 * Zincir: Bridge (HTTP) -> BridgeClient -> Supervisor servisi -> IPC -> MCP.
 * Her sınır bir sarmalayıcı koda ("bir şeyler ters gitti") düşerse KPI-08
 * anlamsızlaşır: ajan hangi aksiyonu alacağını bilemez.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { BridgeClient, BridgeClientError } from '../src/bridge-client.js';
import { toIpcError } from '../src/ipc-server.js';

const TOKEN = 'token-for-test';

/** Sabit bir hata gövdesi döndüren sahte Bridge. */
async function withFakeBridge(
  status: number,
  body: unknown,
  run: (client: BridgeClient) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  try {
    await run(new BridgeClient(port, TOKEN));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('Bridge error catalog kodu istemcide korunur', async () => {
  await withFakeBridge(
    400,
    { ok: false, error: { code: 'TOOL_INPUT_INVALID', message: 'salt okuma değildir' } },
    async (client) => {
      await assert.rejects(
        () => client.query('world.set_block'),
        (err: unknown) => {
          assert.ok(err instanceof BridgeClientError);
          // Sarmalayıcı koda DÜŞMEMELİ.
          assert.equal(err.code, 'TOOL_INPUT_INVALID');
          assert.equal(err.httpStatus, 400);
          assert.match(err.message, /salt okuma/);
          return true;
        },
      );
    },
  );
});

test('CHUNK_NOT_LOADED kodu korunur', async () => {
  await withFakeBridge(
    409,
    { ok: false, error: { code: 'CHUNK_NOT_LOADED', message: 'Hedef chunk yüklü değil: 0,0' } },
    async (client) => {
      await assert.rejects(
        () => client.query('world.get_block'),
        (err: unknown) => err instanceof BridgeClientError && err.code === 'CHUNK_NOT_LOADED',
      );
    },
  );
});

test('kodsuz hata gövdesi jenerik koda düşer', async () => {
  await withFakeBridge(500, { ok: false }, async (client) => {
    await assert.rejects(
      () => client.query('server.get_state'),
      (err: unknown) => err instanceof BridgeClientError && err.code === 'BRIDGE_REQUEST_FAILED',
    );
  });
});

test('Bridge kodu IPC sınırında da korunur', () => {
  // Supervisor servisi hatayı olduğu gibi yukarı fırlatır; toIpcError kodu
  // okur ve IPC yanıtına taşır.
  const bridgeError = new BridgeClientError('CHUNK_NOT_LOADED', 'Hedef chunk yüklü değil', 409);
  const ipcError = toIpcError(bridgeError);

  assert.equal(ipcError.code, 'CHUNK_NOT_LOADED');
  assert.ok(ipcError.suggested_action.length >= 8, 'KPI-08: önerilen aksiyon zorunlu');
});

test('yeniden denenebilirlik error catalog ile hizalı', () => {
  assert.equal(toIpcError(Object.assign(new Error('x'), { code: 'BRIDGE_BUSY' })).retryable, true);
  assert.equal(toIpcError(Object.assign(new Error('x'), { code: 'RUNTIME_QUOTA_EXCEEDED' })).retryable, true);

  // Mutation belirsizliği ASLA yeniden denenebilir işaretlenmez.
  assert.equal(toIpcError(Object.assign(new Error('x'), { code: 'MUTATION_UNKNOWN_OUTCOME' })).retryable, false);
  assert.equal(toIpcError(Object.assign(new Error('x'), { code: 'TOOL_INPUT_INVALID' })).retryable, false);
});
