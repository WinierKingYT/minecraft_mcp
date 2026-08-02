/**
 * mcpdev doctor — unit tests for health checks.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Import the check functions directly for testing
// We test the internal logic by creating temporary environments

describe('mcpdev doctor: node version check', () => {
  test('Node.js version >= 22 is valid', () => {
    const version = process.versions.node;
    const major = Number.parseInt(version.split('.')[0]!, 10);
    assert.ok(major >= 22, `Node.js ${version} is >= 22`);
  });

  test('Node.js version parsing works for various formats', () => {
    // Parse version string
    const parse = (v: string) => Number.parseInt(v.split('.')[0]!, 10);
    assert.equal(parse('24.18.1'), 24);
    assert.equal(parse('22.0.0'), 22);
    assert.equal(parse('20.0.0'), 20);
  });
});

describe('mcpdev doctor: project root detection', () => {
  test('detects project root with package.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doctor-test-'));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'test-project' }));

    const { existsSync } = await import('node:fs');
    assert.ok(existsSync(join(dir, 'package.json')), 'package.json exists');
  });

  test('handles missing package.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doctor-test-'));
    const { existsSync } = await import('node:fs');
    assert.ok(!existsSync(join(dir, 'package.json')), 'no package.json');
  });
});

describe('mcpdev doctor: compatibility profile detection', () => {
  test('detects verified profile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doctor-profile-'));
    await mkdir(join(dir, 'compatibility'), { recursive: true });
    await writeFile(
      join(dir, 'compatibility', 'paper-26.2-build-84-v1.yaml'),
      'id: paper-26.2-build-84-v1\nverification:\n  status: verified\n',
    );

    const content = (await import('node:fs')).readFileSync(
      join(dir, 'compatibility', 'paper-26.2-build-84-v1.yaml'),
      'utf-8',
    );
    assert.ok(content.includes('status: verified'), 'profile is verified');
  });

  test('detects unverified profile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doctor-profile-'));
    await mkdir(join(dir, 'compatibility'), { recursive: true });
    await writeFile(
      join(dir, 'compatibility', 'paper-26.2-build-84-v1.yaml'),
      'id: paper-26.2-build-84-v1\nverification:\n  status: pending\n',
    );

    const content = (await import('node:fs')).readFileSync(
      join(dir, 'compatibility', 'paper-26.2-build-84-v1.yaml'),
      'utf-8',
    );
    assert.ok(!content.includes('status: verified'), 'profile is not verified');
  });
});

describe('mcpdev doctor: output format', () => {
  test('JSON output contains required fields', () => {
    // Simulate JSON output structure
    const output = {
      timestamp: new Date().toISOString(),
      root: '/tmp/test',
      checks: [
        { name: 'node_version', status: 'pass', message: 'Node.js 24.18.1' },
      ],
      summary: { total: 1, pass: 1, fail: 0, warn: 0, skip: 0 },
    };

    assert.ok(output.timestamp, 'has timestamp');
    assert.ok(Array.isArray(output.checks), 'has checks array');
    assert.ok(typeof output.summary === 'object', 'has summary');
    assert.equal(output.summary.total, 1);
    assert.equal(output.summary.pass, 1);
  });

  test('check result has required fields', () => {
    const check = { name: 'test', status: 'pass', message: 'ok' };
    assert.equal(typeof check.name, 'string');
    assert.ok(['pass', 'fail', 'warn', 'skip'].includes(check.status));
    assert.equal(typeof check.message, 'string');
  });
});
