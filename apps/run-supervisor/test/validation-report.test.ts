/**
 * ST-CHECKSUM-001..003 — `distributionSha256Valid` aggregation semantiği.
 *
 * Eski davranış "checksum mevcut"u "geçerli" diye etiketliyordu (service.ts).
 * Gerçek semantik: varlık + eşleşme (validator'ün INVALID bulgusu üretmediği).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distributionChecksumValid } from '../src/validation-report.js';

const INVALID_MAVEN = 'MVN_DISTRIBUTION_CHECKSUM_INVALID';
const INVALID_GRADLE = 'GRADLE_DISTRIBUTION_CHECKSUM_INVALID';

test('ST-CHECKSUM-001: checksum yoksa false (varlık yok → doğrulanmış değil)', () => {
  assert.equal(distributionChecksumValid(null, [], INVALID_MAVEN), false);
});

test('ST-CHECKSUM-002: eşleşmeyen checksum INVALID bulgusu ürettiyse false', () => {
  const findings = [
    { code: INVALID_MAVEN, severity: 'error', message: 'eşleşmiyor', suggestedAction: 'yeniden indirin' },
  ];
  assert.equal(distributionChecksumValid('deadbeef', findings, INVALID_MAVEN), false);
});

test('ST-CHECKSUM-003: checksum varsa ve INVALID bulgusu yoksa true', () => {
  const findings = [
    { code: 'MVN_DISTRIBUTION_URL_UNAPPROVED', severity: 'error', message: 'host', suggestedAction: 'düzelt' },
  ];
  assert.equal(distributionChecksumValid('deadbeef', findings, INVALID_MAVEN), true);
});

test('Gradle INVALID kodu Maven kodundan bağımsız değerlendirilir', () => {
  const mavenInvalidOnly = [
    { code: INVALID_MAVEN, severity: 'error', message: 'x', suggestedAction: 'y' },
  ];
  // Gradle tarafı Maven INVALID bulgusunu kendi eşleşmesi sanmamalı.
  assert.equal(distributionChecksumValid('deadbeef', mavenInvalidOnly, INVALID_GRADLE), true);
});