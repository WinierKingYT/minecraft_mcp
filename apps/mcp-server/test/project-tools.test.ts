/**
 * CT-PROJECT-LIST-001 — project_* tool yüzeyi.
 *
 * Proje kaydı launcher config/CLI yüzeyindendir; agent yüzeyinde register
 * tool'u yoktur (R3 mutation — ADR-0007). Yalnızca read-only yüzey
 * denetlenir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectTools } from '../src/tools/project.js';
import type { SupervisorClient } from '../src/supervisor-client.js';
import type { ToolDefinition, ToolHandler } from '../src/tools/facade.js';
import type { ToolProfileName } from '@mcpdev/generated-types';

type Ctx = { correlationId: string; profile: ToolProfileName };
type Tuple = [ToolDefinition, ToolHandler];

const CTX: Ctx = { correlationId: 'cor_test', profile: 'developer' };

function tupleHandler(tuples: Tuple[], name: string): Tuple {
  const found = tuples.find(([d]) => (d as { name?: string })?.name === name);
  assert.ok(found, `tool bulunamadı: ${name}`);
  return found;
}

function makeFakeSupervisor(routes: Record<string, (params: unknown) => unknown>): SupervisorClient {
  return {
    call: async (method: string, params: never) => {
      const handler = routes[method];
      if (!handler) {
        throw Object.assign(new Error(`no route ${method}`), { code: 'SUPERVISOR_INTERNAL_ERROR' });
      }
      return handler(params);
    },
  } as unknown as SupervisorClient;
}

const REGISTERED_RESULT = {
  projectId: 'demo',
  rootPath: 'C:\\proje',
  trustLevel: 'developer-workspace',
  allowedBackends: ['trusted-local', 'container'],
  defaultBackend: 'trusted-local',
};

test('project_list tüm kayıtları listeler', async () => {
  const info = {
    supervisor: async () =>
      makeFakeSupervisor({
        'project.list': (params) => {
          assert.deepEqual(params, {});
          return { projects: [REGISTERED_RESULT] };
        },
      }),
  };
  const [, fn] = tupleHandler(createProjectTools(info), 'project_list');

  const r = await fn({}, CTX);

  assert.equal(r.status, 'success');
  const projects = (r as { data?: { projects?: Array<{ project_id?: string }> } }).data?.projects;
  assert.equal(projects?.length, 1);
  assert.equal(projects?.[0]?.project_id, 'demo');
});

test('project_list project_id filtresini taşır', async () => {
  let sent: unknown = null;
  const info = {
    supervisor: async () =>
      makeFakeSupervisor({
        'project.list': (params) => {
          sent = params;
          return { projects: [REGISTERED_RESULT] };
        },
      }),
  };
  const [, fn] = tupleHandler(createProjectTools(info), 'project_list');

  const r = await fn({ project_id: 'demo' }, CTX);

  assert.equal(r.status, 'success');
  assert.deepEqual(sent, { projectId: 'demo' });
});

test('project_list kayıt yoksa boş liste döner', async () => {
  const info = {
    supervisor: async () =>
      makeFakeSupervisor({
        'project.list': () => ({ projects: [] }),
      }),
  };
  const [, fn] = tupleHandler(createProjectTools(info), 'project_list');

  const r = await fn({}, CTX);

  assert.equal(r.status, 'success');
  assert.deepEqual((r as { data?: { projects?: unknown[] } }).data?.projects, []);
});

test('tool yüzeyi register toolu içermez (ADR-0007: R3/R4 agent-facing olamaz)', async () => {
  const tuples = createProjectTools({ supervisor: async () => null });
  const names = tuples.map(([d]) => (d as { name?: string }).name);
  assert.deepEqual(names, ['project_list', 'project_inspect', 'project_validate']);
});

test('agent yüzeyine raw host path sızmaz (contract: Raw host path dışarı verilmez)', async () => {
  const info = {
    supervisor: async () =>
      makeFakeSupervisor({
        'project.list': () => ({ projects: [REGISTERED_RESULT] }),
        'project.inspect': () => ({ ...REGISTERED_RESULT, gradleWrapper: {}, pluginMetadata: {}, testContract: null }),
      }),
  };
  const tuples = createProjectTools(info);
  const [listDef, listFn] = tupleHandler(tuples, 'project_list');
  const [, inspectFn] = tupleHandler(tuples, 'project_inspect');

  assert.equal(
    JSON.stringify(listDef).includes('root_path') || JSON.stringify(listDef).includes('rootPath'),
    false,
    'project_list şeması host path alanı taşımamalı',
  );

  const listR = await listFn({}, CTX);
  assert.equal(JSON.stringify(listR).includes('C:\\proje'), false, 'project_list yanıtı host path içermemeli');

  const inspectR = await inspectFn({ project_id: 'demo' }, CTX);
  assert.equal(JSON.stringify(inspectR).includes('C:\\proje'), false, 'project_inspect yanıtı host path içermemeli');
});
