/**
 * ResourceFacade unit testleri — docs/contracts/mcp.md "Resources"
 * bölümünün domain yüzeyi. Stub supervisor client üzerinden IPC'siz koşulur;
 * konkre SDK/kablo testleri conformance-official-client.test.ts'dedir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResourceNotFoundError } from '@modelcontextprotocol/server';
import { ResourceFacade, RESOURCE_MAX_BYTES, RESOURCE_MIME } from '../src/resources/facade.js';
import type { ResourceTemplateSpec } from '../src/resources/facade.js';
import type { SupervisorClient } from '../src/supervisor-client.js';

type Handler = (params: Record<string, unknown>) => unknown;

function stubClient(handlers: Record<string, Handler>): SupervisorClient {
  return {
    call: async (method: string, params: unknown) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`stub: unhandled method ${method}`);
      return handler((params ?? {}) as Record<string, unknown>);
    },
  } as unknown as SupervisorClient;
}

function facadeWith(handlers: Record<string, Handler>): ResourceFacade {
  return new ResourceFacade({ supervisor: async () => stubClient(handlers) });
}

function findTemplate(facade: ResourceFacade, name: string): ResourceTemplateSpec {
  const spec = facade.listTemplates().find((s) => s.name === name);
  assert.ok(spec, `şablon bulunamadı: ${name}`);
  return spec!;
}

async function readResource(
  spec: ResourceTemplateSpec,
  uri: string,
  variables: Record<string, string>,
): Promise<{ contents: Array<{ text?: string }> }> {
  // ctx, facade tarafından kullanılmaz; SDK çağrı sözleşmesini doldurmak için geçilir.
  return spec.read(new URL(uri), variables, {} as never) as Promise<{ contents: Array<{ text?: string }> }>;
}

async function readText(spec: ResourceTemplateSpec, uri: string, variables: Record<string, string>): Promise<string> {
  const result = await readResource(spec, uri, variables);
  const content = result.contents[0];
  assert.ok(typeof content?.text === 'string', 'read text içerik döndürmeli');
  return content.text!;
}

const RUN_GET_RESULT = {
  runId: 'run_abc',
  scenarioId: 'sc_1',
  scenarioPath: 'scenarios/sc_1.yml',
  projectId: 'demo',
  runtimeImageId: 'rt_1',
  bridgeBootId: 'boot_1',
  status: 'completed',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:01:00.000Z',
  durationMs: 60_000,
  summary: { totalSteps: 3, passed: 2, failed: 0, skipped: 1, evidenceCount: 5 },
  logs: [
    { phase: 'given', stepName: 'server başlar', status: 'passed', durationMs: 100, operation: 'server-state', error: null, suggestedAction: null },
  ],
  events: [
    { kind: 'step', stepName: 'server başlar', passed: true, message: 'READY', durationMs: 100 },
  ],
  evidenceIds: ['ev_1', 'ev_2', 'ev_3'],
};

test('listTemplates — 9 şablon, mimeType ve tamamlama callbacks taşır', () => {
  const facade = facadeWith({});
  const templates = facade.listTemplates();
  assert.equal(templates.length, 9);
  const expected = [
    'minecraft://run/{run_id}/status',
    'minecraft://run/{run_id}/logs',
    'minecraft://run/{run_id}/events',
    'minecraft://run/{run_id}/report',
    'minecraft://run/{run_id}/evidence',
    'minecraft://operation/{operation_id}',
    'minecraft://project/{project_id}/manifest',
    'minecraft://runtime/{server_instance_id}/capabilities',
    'minecraft://artifact/{build_artifact_id}',
  ].sort();
  assert.deepEqual(templates.map((t) => t.uriTemplate).sort(), expected);
  for (const t of templates) {
    assert.equal(t.metadata.mimeType, RESOURCE_MIME);
    assert.ok(t.read, `${t.name} read callback taşımalı`);
    assert.ok(t.list, `${t.name} list callback taşımalı`);
  }
  // Tüm tamamlama callback'leri bağlı olmalı.
  for (const t of templates) {
    const vars = [...new Set(t.uriTemplate.match(/\{(\w+)\}/g) ?? [])].map((v) => v.slice(1, -1));
    for (const v of vars) {
      assert.equal(typeof t.complete[v], 'function', `${t.name}: ${v} tamamlama callback i`);
    }
  }
});

test('run/status read — run durumu ve özet döner', async () => {
  const facade = facadeWith({ 'run.get': () => RUN_GET_RESULT });
  const spec = findTemplate(facade, 'run_status');
  const text = await readText(spec, 'minecraft://run/run_abc/status', { run_id: 'run_abc' });
  assert.match(text, /"run_id": "run_abc"/);
  assert.match(text, /"status": "completed"/);
  assert.match(text, /"passed": 2/);
  // status yüzeyi bridge detayını taşımaz (minimal projeksiyon).
  assert.ok(!text.includes('boot_1'), 'status yüzeyi bridgeBootId içermemeli');
});

test('run/logs read — adım günlükleri içerik kapağına bağlanır', async () => {
  const manyLogs = Array.from({ length: 50 }, (_, i) => ({
    phase: 'when', stepName: `adım ${i}`, status: 'passed', durationMs: 5, operation: null, error: null, suggestedAction: null,
  }));
  const facade = facadeWith({ 'run.get': () => ({ ...RUN_GET_RESULT, logs: manyLogs }) });
  const spec = findTemplate(facade, 'run_logs');
  const text = await readText(spec, 'minecraft://run/run_abc/logs', { run_id: 'run_abc' });
  assert.match(text, /"adım 49"/);
});

test('run/report read — kanıt referanslı rapor şekli üretir', async () => {
  const facade = facadeWith({ 'run.get': () => RUN_GET_RESULT });
  const spec = findTemplate(facade, 'run_report');
  const text = await readText(spec, 'minecraft://run/run_abc/report', { run_id: 'run_abc' });
  assert.match(text, /"schema": "run-report-v1"/);
  assert.match(text, /"evidence_ids": \[/);
  assert.match(text, /"scenario_path": "scenarios\/sc_1\.yml"/);
});

test('run read — bilinmeyen runId RUN_NOT_FOUND -> RESOURCE_NOT_FOUND eşlenir', async () => {
  const facade = facadeWith({
    'run.get': () => {
      const err = new Error('RUN_NOT_FOUND');
      (err as { code?: string }).code = 'RUN_NOT_FOUND';
      throw err;
    },
  });
  const spec = findTemplate(facade, 'run_status');
  await assert.rejects(
    async () => readResource(spec, 'minecraft://run/ghost/status', { run_id: 'ghost' }),
    (err: unknown) => err instanceof ResourceNotFoundError && err.uri === 'minecraft://run/ghost/status',
  );
});

test('project manifest — raw host path (rootPath) dışarı verilmez', async () => {
  const facade = facadeWith({
    'project.inspect': () => ({
      projectId: 'demo',
      rootPath: 'C:\\Users\\faruk\\secret\\proj',
      trustLevel: 'approved-fixture',
      gradleWrapper: { found: true, jarExists: true, propertiesExists: true },
      pluginMetadata: { found: true, name: 'demo', version: '1.0.0', mainClass: 'dev.Demo', apiVersion: '1.20' },
      testContract: { found: false },
    }),
  });
  const spec = findTemplate(facade, 'project_manifest');
  const text = await readText(spec, 'minecraft://project/demo/manifest', { project_id: 'demo' });
  assert.match(text, /"project_id": "demo"/);
  assert.match(text, /"trust_level": "approved-fixture"/);
  assert.ok(!text.includes('C:\\'), 'manifest mutlak host path içermemeli');
  assert.ok(!/rootPath|root_path/.test(text), 'rootPath anahtarı manifeste düşmemeli');
});

test('artifact read — relativePath taşınır, mutlak yol içermez', async () => {
  const facade = facadeWith({
    'build.resolve': () => ({
      buildId: 'build_7',
      projectId: 'demo',
      mode: 'build',
      backend: 'trusted-local',
      status: 'completed',
      artifact: { id: 'art_1', relativePath: 'build/libs/demo-1.0.0.jar', sha256: 'a'.repeat(64), byteSize: 1234 },
      createdAt: '2026-01-01T00:00:00.000Z',
      durationMs: 500,
    }),
  });
  const spec = findTemplate(facade, 'artifact');
  const text = await readText(spec, 'minecraft://artifact/build_7', { build_artifact_id: 'build_7' });
  assert.match(text, /"relativePath": "build\/libs\/demo-1\.0\.0\.jar"/);
  assert.match(text, /"byteSize": 1234/);
  assert.ok(!text.includes('C:\\'), 'artifact metadata mutlak yol içermemeli');
});

test('operation read — args/result redaction ikinci katmanda da maskelenir', async () => {
  const facade = facadeWith({
    'operation.get': () => ({
      operationId: 'op_1',
      operation: 'server-state',
      runtimeId: 'rt_1',
      status: 'completed',
      timestamp: 1234,
      args: { token: 'secret_token_123', password: 'hunter2', playerIp: '10.0.0.5', hostPath: 'C:\\Users\\faruk\\x' },
      result: { ok: true },
    }),
  });
  const spec = findTemplate(facade, 'operation');
  const text = await readText(spec, 'minecraft://operation/op_1', { operation_id: 'op_1' });
  assert.ok(!text.includes('secret_token_123'), 'token maskelenmeli');
  assert.ok(!text.includes('hunter2'), 'password maskelenmeli');
  assert.ok(!text.includes('10.0.0.5'), 'IP maskelenmeli');
  assert.ok(!text.includes('C:\\'), 'host path maskelenmeli');
  assert.ok(text.includes('[REDACTED]'), 'redaction işareti taşımalı');
});

test('operation read — bayt sınırı aşılınca truncate işareti döner', async () => {
  const facade = facadeWith({
    'operation.get': () => ({
      operationId: 'op_big',
      operation: 'server-state',
      runtimeId: 'rt_1',
      status: 'failed',
      timestamp: 1,
      args: { payload: 'x'.repeat(600 * 1024) },
      error: 'zaten büyük',
    }),
  });
  const spec = findTemplate(facade, 'operation');
  const text = await readText(spec, 'minecraft://operation/op_big', { operation_id: 'op_big' });
  assert.ok(text.includes('byte_limit exceeded'), 'truncate işareti taşımalı');
  assert.ok(text.length < RESOURCE_MAX_BYTES + 200, 'kesilmiş içerik sınırı aşmamalı');
});

test('list callbacks — supervisor kapalıyken boş (dayanıklı) liste döner', async () => {
  const facade = new ResourceFacade({ supervisor: async () => null });
  for (const name of ['run_status', 'operation', 'project_manifest', 'runtime_capabilities', 'artifact']) {
    const spec = findTemplate(facade, name);
    const listed = await spec.list!();
    assert.deepEqual(listed, [], `${name} list callback boş dönmeli`);
  }
});

test('list callbacks — supervisor IPC hata verirse boş liste döner, read hata yayar', async () => {
  const facade = facadeWith({
    'run.list': () => {
      const err = new Error('run.list bozuk');
      (err as { code?: string }).code = 'INTERNAL';
      throw err;
    },
    'run.get': () => {
      const err = new Error('run.get bozuk');
      (err as { code?: string }).code = 'INTERNAL';
      throw err;
    },
  });
  const spec = findTemplate(facade, 'run_status');
  assert.deepEqual(await spec.list!(), [], 'list IPC hatası boş listeye çevrilir');
  await assert.rejects(
    async () => readResource(spec, 'minecraft://run/x/status', { run_id: 'x' }),
    /run\.get bozuk/,
  );
});

test('read — supervisor kapalıyken SUPERVISOR_UNAVAILABLE hatası yayılır', async () => {
  const facade = new ResourceFacade({ supervisor: async () => null });
  const spec = findTemplate(facade, 'run_status');
  await assert.rejects(
    async () => readResource(spec, 'minecraft://run/x/status', { run_id: 'x' }),
    /SUPERVISOR_UNAVAILABLE/,
  );
});

test('completion callbacks — supervisor varken filtreli id listesi döner', async () => {
  const facade = facadeWith({
    'run.list': () => ({ runs: [{ runId: 'run_aaa' }, { runId: 'run_bbb' }] }),
  });
  const spec = findTemplate(facade, 'run_status');
  const completed = await spec.complete['run_id']!('run_a');
  assert.deepEqual(completed, ['run_aaa']);
  const empty = await spec.complete['run_id']!('zzz');
  assert.deepEqual(empty, []);
});

test('completion callbacks — supervisor kapalıyken boş döner', async () => {
  const facade = new ResourceFacade({ supervisor: async () => null });
  const spec = findTemplate(facade, 'project_manifest');
  const completed = await spec.complete['project_id']!('demo');
  assert.deepEqual(completed, []);
});
