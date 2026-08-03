import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { listCompatibilityProfiles, loadCompatibilityProfile } from '../src/compatibility.js';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

describe('Compatibility Profiles', () => {
  test('listCompatibilityProfiles returns at least one profile', () => {
    const profiles = listCompatibilityProfiles(REPO_ROOT);
    assert.ok(profiles.length >= 1, `Expected at least 1 profile, got ${profiles.length}`);
  });

  test('listCompatibilityProfiles includes paper-26.2-build-84-v1', () => {
    const profiles = listCompatibilityProfiles(REPO_ROOT);
    const found = profiles.find((p) => p.id === 'paper-26.2-build-84-v1');
    assert.ok(found, 'paper-26.2-build-84-v1 not found');
    assert.equal(found.minecraftVersion, '26.2');
    assert.equal(found.paperBuild, 84);
  });

  test('listCompatibilityProfiles includes paper-26.2-build-87-v1', () => {
    const profiles = listCompatibilityProfiles(REPO_ROOT);
    const found = profiles.find((p) => p.id === 'paper-26.2-build-87-v1');
    assert.ok(found, 'paper-26.2-build-87-v1 not found');
    assert.equal(found.minecraftVersion, '26.2');
    assert.equal(found.paperBuild, 87);
    assert.equal(found.verificationStatus, 'unverified');
  });

  test('listCompatibilityProfiles includes paper-26.2-build-90-v1 (third profile)', () => {
    const profiles = listCompatibilityProfiles(REPO_ROOT);
    const found = profiles.find((p) => p.id === 'paper-26.2-build-90-v1');
    assert.ok(found, 'paper-26.2-build-90-v1 not found');
    assert.equal(found.minecraftVersion, '26.2');
    assert.equal(found.paperBuild, 90);
    assert.equal(found.verificationStatus, 'unverified');
  });

  test('listCompatibilityProfiles returns at least three profiles (multi-profile diverge)', () => {
    const profiles = listCompatibilityProfiles(REPO_ROOT);
    assert.ok(profiles.length >= 3, `Expected >= 3 profiles, got ${profiles.length}`);
  });

  test('loadCompatibilityProfile loads paper-26.2-build-84-v1', () => {
    const profile = loadCompatibilityProfile(REPO_ROOT, 'paper-26.2-build-84-v1');
    assert.equal(profile.id, 'paper-26.2-build-84-v1');
    assert.equal(profile.minecraft.version, '26.2');
    assert.equal(profile.paper.build, 84);
    assert.equal(profile.java.runtime_major, 25);
    assert.equal(profile.node.version, '24.18.1');
  });

  test('loadCompatibilityProfile loads paper-26.2-build-87-v1', () => {
    const profile = loadCompatibilityProfile(REPO_ROOT, 'paper-26.2-build-87-v1');
    assert.equal(profile.id, 'paper-26.2-build-87-v1');
    assert.equal(profile.paper.build, 87);
    assert.equal(profile.paper.jar_sha256, null); // Not yet verified
  });

  test('loadCompatibilityProfile loads paper-26.2-build-90-v1', () => {
    const profile = loadCompatibilityProfile(REPO_ROOT, 'paper-26.2-build-90-v1');
    assert.equal(profile.id, 'paper-26.2-build-90-v1');
    assert.equal(profile.paper.build, 90);
    assert.equal(profile.paper.jar_sha256, null); // Not yet verified
    assert.equal(profile.java.runtime_major, 25);
  });

  test('loadCompatibilityProfile throws for non-existent profile', () => {
    assert.throws(
      () => loadCompatibilityProfile(REPO_ROOT, 'non-existent-profile'),
      /Uyumluluk profili bulunamadı/,
    );
  });
});
