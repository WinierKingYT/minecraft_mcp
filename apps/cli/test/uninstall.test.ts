/**
 * mcpdev uninstall — unit tests for uninstall command.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { runUninstall } from '../src/uninstall.js';

describe('mcpdev uninstall: directory removal', () => {
  test('removes node_modules directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uninstall-test-'));
    await writeFile(join(root, 'package.json'), '{"name":"test"}');
    const nmDir = join(root, 'node_modules');
    await mkdir(nmDir, { recursive: true });
    await writeFile(join(nmDir, 'test.txt'), 'content');

    await runUninstall({ root, json: true });

    assert.equal(existsSync(nmDir), false, 'node_modules should be removed');
  });

  test('removes dist directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uninstall-test-'));
    await writeFile(join(root, 'package.json'), '{"name":"test"}');
    const distDir = join(root, 'apps', 'mcp-server', 'dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'index.js'), 'module.exports = {};');

    await runUninstall({ root, json: true });

    assert.equal(existsSync(distDir), false, 'dist should be removed');
  });

  test('skips non-existent directories gracefully', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uninstall-test-'));
    await writeFile(join(root, 'package.json'), '{"name":"test"}');

    // Should not throw
    await runUninstall({ root, json: true });
  });
});

describe('mcpdev uninstall: JSON output', () => {
  test('produces valid JSON output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uninstall-test-'));
    await writeFile(join(root, 'package.json'), '{"name":"test"}');

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await runUninstall({ root, json: true });
    } finally {
      process.stdout.write = originalWrite;
    }

    const parsed = JSON.parse(output);
    assert.equal(parsed.command, 'uninstall');
    assert.ok(Array.isArray(parsed.steps));
    assert.equal(typeof parsed.totalRemoved, 'number');
    assert.equal(typeof parsed.totalBytes, 'number');
  });
});

describe('mcpdev uninstall: root validation', () => {
  test('exits with error for invalid root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uninstall-test-'));
    // No package.json

    let exitCode = 0;
    const originalExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error('process.exit called');
    }) as typeof process.exit;

    try {
      await runUninstall({ root });
    } catch {
      // expected
    } finally {
      process.exit = originalExit;
    }

    assert.equal(exitCode, 1, 'Should exit with code 1 for invalid root');
  });
});
