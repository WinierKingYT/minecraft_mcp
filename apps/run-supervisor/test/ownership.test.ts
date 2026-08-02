/**
 * ST-PROC-003 — bilinmeyen PID körlemesine öldürülmez.
 *
 * Bu testler saf karar fonksiyonlarını hedefler; gerçek process sonlandırma
 * execution backend'in işidir. Kararı eylemden ayırmak, kuralın gerçekten
 * test edilebilir olmasını sağlar (ADR-0003).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyOwnership, mayTerminate, type OwnershipRecord, type ProcessFingerprint } from '../src/ownership.js';
import { assertBackendPairing, BackendSecurityDowngradeError } from '../src/backend.js';
import { runStartupRecovery } from '../src/index.js';

const record: OwnershipRecord = {
  runtimeId: 'rimg_test',
  serverInstanceId: 'srv_test',
  kind: 'paper',
  registeredAtMs: 1_000,
  pid: 4242,
  executablePath: 'C:/java/bin/java.exe',
  startedAtMs: 1_700_000_000_000,
  runtimeMarkerSha256: 'sha256:aaa',
};

const matching: ProcessFingerprint = {
  pid: 4242,
  executablePath: 'C:/java/bin/java.exe',
  startedAtMs: 1_700_000_000_000,
  runtimeMarkerSha256: 'sha256:aaa',
};

test('dört alan da eşleşince sahiplik doğrulanır', () => {
  assert.deepEqual(verifyOwnership(record, matching), { owned: true });
  assert.equal(mayTerminate(record, matching), true);
});

test('PID aynı fakat başlangıç zamanı farklıysa sahiplik reddedilir (PID reuse)', () => {
  const reused: ProcessFingerprint = { ...matching, startedAtMs: 1_700_000_999_999 };
  const verdict = verifyOwnership(record, reused);

  assert.equal(verdict.owned, false);
  assert.equal(verdict.owned === false && verdict.errorCode, 'PROCESS_OWNERSHIP_MISMATCH');
  assert.equal(mayTerminate(record, reused), false, 'PID reuse durumunda ÖLDÜRME YAPILMAMALI');
});

test('executable path farklıysa sahiplik reddedilir', () => {
  const other: ProcessFingerprint = { ...matching, executablePath: 'C:/Windows/notepad.exe' };
  assert.equal(mayTerminate(record, other), false);
});

test('runtime marker fingerprint farklıysa sahiplik reddedilir', () => {
  const other: ProcessFingerprint = { ...matching, runtimeMarkerSha256: 'sha256:bbb' };
  assert.equal(mayTerminate(record, other), false);
});

test('process artık yoksa uyuşmazlık değildir ve sonlandırma denenmez', () => {
  assert.deepEqual(verifyOwnership(record, null), { owned: true });
  assert.equal(mayTerminate(record, null), false, 'sonlanmış process için terminate çağrılmamalı');
});

test('startup recovery uyuşmayan kayıtları ORPHANED işaretler, öldürmez', () => {
  const stale: OwnershipRecord = { ...record, pid: 9999 };
  const { reclaimed, orphaned } = runStartupRecovery([record, stale], (pid) =>
    pid === 4242 ? matching : { ...matching, pid: 9999, startedAtMs: 1 },
  );

  assert.equal(reclaimed.length, 1);
  assert.equal(orphaned.length, 1);
  assert.equal(orphaned[0]?.pid, 9999);
});

test('ADR-0004: container build + trusted-local runtime reddedilir', () => {
  assert.throws(
    () => assertBackendPairing('container', 'trusted-local'),
    (err: unknown) => err instanceof BackendSecurityDowngradeError && err.code === 'BACKEND_SECURITY_DOWNGRADE',
  );
});

test('ADR-0004: eşit veya daha güçlü runtime backend kabul edilir', () => {
  assert.doesNotThrow(() => assertBackendPairing('container', 'container'));
  assert.doesNotThrow(() => assertBackendPairing('trusted-local', 'trusted-local'));
  assert.doesNotThrow(() => assertBackendPairing('trusted-local', 'container'));
});
