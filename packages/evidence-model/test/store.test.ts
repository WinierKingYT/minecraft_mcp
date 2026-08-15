/**
 * IT-EVIDENCE-001 — evidence store bütünlüğü ve redaction.
 *
 * En kritik testler: "değiştirilmiş nesne TESPİT edilir" ve "secret depoya
 * girmez". İkisi de ADR-0007'nin tespit/önleme ayrımını somutlaştırır.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore, EvidenceStoreError, applyRedaction, assertProvenanceComplete } from '../src/index.js';
import type { EvidenceProducer } from '../src/index.js';

const PRODUCER: EvidenceProducer = {
  component: 'paper-bridge',
  version: '0.1.0-prototype.0',
  serverInstanceId: 'srv_test',
  bridgeBootId: 'boot_test',
};

async function store(): Promise<EvidenceStore> {
  return new EvidenceStore(await mkdtemp(join(tmpdir(), 'evidence-')));
}

test('kanıt yazılır ve manifest bütünlük alanlarını taşır', async () => {
  const s = await store();

  const manifest = await s.put({
    runId: 'run_1',
    scenarioRunId: null,
    kind: 'runtime-log',
    producer: PRODUCER,
    content: 'server ready\nplugin enabled\n',
  });

  assert.match(manifest.evidenceId, /^ev_[0-9a-f]{24}$/);
  assert.match(manifest.integrity.sha256, /^[0-9a-f]{64}$/);
  assert.ok(manifest.integrity.byteSize > 0);
  assert.equal(manifest.producer.component, 'paper-bridge');
  assert.ok(manifest.retention.expiresAt > manifest.retention.createdAt);
});

test('aynı içerik aynı nesneye düşer (content addressing)', async () => {
  const s = await store();
  const content = 'aynı içerik';

  const a = await s.put({ runId: 'run_1', scenarioRunId: null, kind: 'event-log', producer: PRODUCER, content });
  const b = await s.put({ runId: 'run_2', scenarioRunId: null, kind: 'event-log', producer: PRODUCER, content });

  assert.equal(a.integrity.sha256, b.integrity.sha256, 'içerik adresi aynı olmalı');
  assert.notEqual(a.evidenceId, b.evidenceId, 'kanıt kimlikleri ayrı kalmalı');
});

test('okuma checksum’ı yeniden doğrular ve değişikliği TESPİT eder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-'));
  const s = new EvidenceStore(root);

  const manifest = await s.put({
    runId: 'run_1',
    scenarioRunId: null,
    kind: 'event-log',
    producer: PRODUCER,
    content: 'orijinal kanıt',
  });

  // Okuma çalışıyor
  const first = await s.get(manifest.evidenceId);
  assert.equal(first.text, 'orijinal kanıt');

  // Host üzerindeki başka bir process nesneyi değiştirsin
  const sha = manifest.integrity.sha256;
  const objectPath = join(root, 'objects', sha.slice(0, 2), sha.slice(2, 4), sha);
  await writeFile(objectPath, 'DEĞİŞTİRİLMİŞ kanıt');

  await assert.rejects(
    () => s.get(manifest.evidenceId),
    (err: unknown) => err instanceof EvidenceStoreError && err.code === 'EVIDENCE_INTEGRITY_MISMATCH',
  );
});

test('token ve secret depoya ham hâliyle girmez', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-'));
  const s = new EvidenceStore(root);

  const secret = 'abcdef0123456789abcdef0123456789';
  const manifest = await s.put({
    runId: 'run_1',
    scenarioRunId: null,
    kind: 'runtime-log',
    producer: PRODUCER,
    content: `Authorization: Bearer ${secret}\nbridge_token=${secret}\nplayer ip 192.168.1.44 joined`,
  });

  const stored = await s.get(manifest.evidenceId);

  assert.equal(stored.text.includes(secret), false, 'token depoda ham durmamalı');
  assert.equal(stored.text.includes('192.168.1.44'), false, 'IP kaydedilmemeli (EV-05)');
  assert.ok(manifest.redaction.removedFields.length > 0, 'kaldırılan alanlar manifestte listelenmeli');
  assert.equal(manifest.redaction.profile, 'default-v1', 'güvensiz varsayılan yok (CF-06)');
});

test('redaction profili none açıkça istenmelidir', () => {
  const text = 'token=abcdef0123456789';

  const masked = applyRedaction(text, 'default-v1');
  assert.equal(masked.text.includes('abcdef0123456789'), false);
  assert.deepEqual(masked.removedFields, ['token']);

  const raw = applyRedaction(text, 'none');
  assert.equal(raw.text, text);
  assert.deepEqual(raw.removedFields, []);
});

test('bulunmayan kanıt açık hata üretir', async () => {
  const s = await store();

  await assert.rejects(
    () => s.get('ev_yok'),
    (err: unknown) => err instanceof EvidenceStoreError && err.code === 'EVIDENCE_NOT_FOUND',
  );
});

test('yarım yazılmış nesne asla görünmez', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-'));
  const s = new EvidenceStore(root);

  const manifest = await s.put({
    runId: 'run_1',
    scenarioRunId: null,
    kind: 'event-log',
    producer: PRODUCER,
    content: 'atomik yazma',
  });

  const sha = manifest.integrity.sha256;
  const objectPath = join(root, 'objects', sha.slice(0, 2), sha.slice(2, 4), sha);

  // .part uzantılı geçici dosya kalmamalı
  const content = await readFile(objectPath, 'utf8');
  assert.equal(content, 'atomik yazma');
});

test('runId üzerinden kanıtlar ve run listesi çözülür', async () => {
  const s = await store();

  await s.put({ runId: 'run_abc', scenarioRunId: 'run_abc', kind: 'assertion-result', producer: PRODUCER, content: 'run özeti' });
  await s.put({ runId: 'run_abc', scenarioRunId: 'run_abc', kind: 'assertion-result', producer: PRODUCER, content: 'adım 1' });
  await s.put({ runId: 'run_def', scenarioRunId: 'run_def', kind: 'runtime-log', producer: PRODUCER, content: 'log' });

  const runAbc = await s.getManifestsByRunId('run_abc');
  assert.equal(runAbc.length, 2);
  assert.ok(runAbc.every((m) => m.runId === 'run_abc'));

  const runIds = await s.listRunIds();
  assert.deepEqual(runIds, ['run_abc', 'run_def']);
});

test('bozuk manifest listeleme yüzeyini düşürmez', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-'));
  const s = new EvidenceStore(root);

  await s.put({ runId: 'run_abc', scenarioRunId: null, kind: 'event-log', producer: PRODUCER, content: 'sağlam' });
  await writeFile(join(root, 'manifests', 'ev_bozuk.json'), '{ yarım json');

  const runIds = await s.listRunIds();
  assert.deepEqual(runIds, ['run_abc']);
});

test('boş depo boş run listesi döner', async () => {
  const s = await store();
  assert.deepEqual(await s.listRunIds(), []);
});

test('retention süresi geçmiş manifest temizlenir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-'));
  const s = new EvidenceStore(root, 0);

  const manifest = await s.put({
    runId: 'run_1',
    scenarioRunId: null,
    kind: 'event-log',
    producer: PRODUCER,
    content: 'kısa ömürlü',
  });

  const expired = await s.expire([manifest.evidenceId], new Date(Date.now() + 1000));
  assert.deepEqual(expired, [manifest.evidenceId]);

  await assert.rejects(() => s.getManifest(manifest.evidenceId));
});

test('eksik provenance zinciri rapor üretimini durdurur', () => {
  assert.throws(
    () =>
      assertProvenanceComplete({
        source_snapshot_id: 'src_1',
        execution_environment_id: 'exe_1',
        build_artifact_id: 'bart_1',
        runtime_image_id: 'rimg_1',
        server_instance_id: 'srv_1',
        scenario_run_id: 'scn_1',
        evidence_ids: [],
        report_id: 'rep_1',
      }),
    /EVIDENCE_INTEGRITY_MISMATCH.*evidence_ids/s,
  );
});

test('tam provenance zinciri kabul edilir', () => {
  assert.doesNotThrow(() =>
    assertProvenanceComplete({
      source_snapshot_id: 'src_1',
      execution_environment_id: 'exe_1',
      build_artifact_id: 'bart_1',
      runtime_image_id: 'rimg_1',
      server_instance_id: 'srv_1',
      scenario_run_id: 'scn_1',
      evidence_ids: ['ev_1'],
      report_id: 'rep_1',
    }),
  );
});
