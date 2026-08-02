import { describe, test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CowFixtureManager } from '../src/cow-fixture.js';
import { join } from 'node:path';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('CowFixtureManager', () => {
  let manager: CowFixtureManager;
  let baseDir: string;

  beforeEach(async () => {
    baseDir = join(tmpdir(), `cow-test-${Date.now()}`);
    await mkdir(baseDir, { recursive: true });
    await writeFile(join(baseDir, 'test.txt'), 'hello world', 'utf8');
    await mkdir(join(baseDir, 'subdir'), { recursive: true });
    await writeFile(join(baseDir, 'subdir', 'nested.txt'), 'nested content', 'utf8');
    manager = new CowFixtureManager({ baseDir });
  });

  afterEach(async () => {
    await manager?.cleanup();
    if (existsSync(baseDir)) {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('creates fixture manager', () => {
    assert.ok(manager);
  });

  test('createFixture creates a new fixture', async () => {
    const fixture = await manager.createFixture('test-fixture');
    assert.equal(fixture.fixtureId, 'test-fixture');
    assert.equal(fixture.isModified, false);
    assert.equal(fixture.modifiedFiles.size, 0);
  });

  test('createFixture generates unique IDs', async () => {
    const f1 = await manager.createFixture();
    const f2 = await manager.createFixture();
    assert.notEqual(f1.fixtureId, f2.fixtureId);
  });

  test('copyFile copies a file to cow directory', async () => {
    const fixture = await manager.createFixture('test');
    const path = await manager.copyFile(fixture.fixtureId, 'test.txt');
    assert.ok(existsSync(path));
    const content = await readFile(path, 'utf8');
    assert.equal(content, 'hello world');
  });

  test('copyFile throws for non-existent fixture', async () => {
    await assert.rejects(
      () => manager.copyFile('non-existent', 'test.txt'),
      /Fixture not found/,
    );
  });

  test('copyFile throws for non-existent source', async () => {
    const fixture = await manager.createFixture('test');
    await assert.rejects(
      () => manager.copyFile(fixture.fixtureId, 'non-existent.txt'),
      /Source file not found/,
    );
  });

  test('copyDirectory copies a directory', async () => {
    const fixture = await manager.createFixture('test');
    const path = await manager.copyDirectory(fixture.fixtureId, 'subdir');
    assert.ok(existsSync(path));
    const content = await readFile(join(path, 'nested.txt'), 'utf8');
    assert.equal(content, 'nested content');
  });

  test('readFile reads from cow directory first', async () => {
    const fixture = await manager.createFixture('test');
    await manager.copyFile(fixture.fixtureId, 'test.txt');
    await manager.writeFile(fixture.fixtureId, 'test.txt', 'modified content');
    const content = await manager.readFile(fixture.fixtureId, 'test.txt');
    assert.equal(content, 'modified content');
  });

  test('readFile falls back to base directory', async () => {
    const fixture = await manager.createFixture('test');
    const content = await manager.readFile(fixture.fixtureId, 'test.txt');
    assert.equal(content, 'hello world');
  });

  test('readFile throws for non-existent file', async () => {
    const fixture = await manager.createFixture('test');
    await assert.rejects(
      () => manager.readFile(fixture.fixtureId, 'non-existent.txt'),
      /File not found/,
    );
  });

  test('writeFile writes to cow directory', async () => {
    const fixture = await manager.createFixture('test');
    await manager.writeFile(fixture.fixtureId, 'new.txt', 'new content');
    const content = await manager.readFile(fixture.fixtureId, 'new.txt');
    assert.equal(content, 'new content');
    assert.equal(fixture.isModified, true);
    assert.ok(fixture.modifiedFiles.has('new.txt'));
  });

  test('deleteFile marks file as modified', async () => {
    const fixture = await manager.createFixture('test');
    await manager.copyFile(fixture.fixtureId, 'test.txt');
    await manager.deleteFile(fixture.fixtureId, 'test.txt');
    assert.equal(fixture.isModified, true);
    assert.ok(fixture.modifiedFiles.has('test.txt'));
  });

  test('commit copies modified files back to base', async () => {
    const fixture = await manager.createFixture('test');
    await manager.copyFile(fixture.fixtureId, 'test.txt');
    await manager.writeFile(fixture.fixtureId, 'test.txt', 'committed content');
    await manager.commit(fixture.fixtureId);
    const content = await readFile(join(baseDir, 'test.txt'), 'utf8');
    assert.equal(content, 'committed content');
    assert.equal(manager.getFixture(fixture.fixtureId), undefined);
  });

  test('rollback removes cow directory', async () => {
    const fixture = await manager.createFixture('test');
    await manager.copyFile(fixture.fixtureId, 'test.txt');
    await manager.writeFile(fixture.fixtureId, 'test.txt', 'rolled back');
    await manager.rollback(fixture.fixtureId);
    assert.equal(manager.getFixture(fixture.fixtureId), undefined);
    const content = await readFile(join(baseDir, 'test.txt'), 'utf8');
    assert.equal(content, 'hello world'); // Original unchanged
  });

  test('listFixtures returns all fixtures', async () => {
    await manager.createFixture('f1');
    await manager.createFixture('f2');
    const fixtures = manager.listFixtures();
    assert.equal(fixtures.length, 2);
  });

  test('cleanup removes all fixtures', async () => {
    await manager.createFixture('f1');
    await manager.createFixture('f2');
    await manager.cleanup();
    assert.equal(manager.listFixtures().length, 0);
  });
});
