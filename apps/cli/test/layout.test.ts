/**
 * mcpdev layout — self-location unit tests (Phase 2 standalone vs workspace).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectLayoutFrom, firstProfileId } from '../src/layout.js';

async function makeStandaloneRoot(t: { dataDir?: string }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'layout-standalone-'));
  await mkdir(join(root, 'dist', 'content', 'compatibility'), { recursive: true });
  await mkdir(join(root, 'dist', 'content', 'bridge'), { recursive: true });
  await mkdir(join(root, 'dist', 'content', 'fixtures', 'manifests'), { recursive: true });
  await mkdir(join(root, 'dist', 'supervisor', 'src'), { recursive: true });
  await mkdir(join(root, 'dist', 'mcp-server', 'src'), { recursive: true });
  await mkdir(join(root, 'dist', 'cli', 'src'), { recursive: true });
  await writeFile(join(root, 'STANDALONE'), '# mcpdev standalone\n');
  await writeFile(
    join(root, 'dist', 'content', 'compatibility', 'paper-26.2-build-84-v1.yaml'),
    'id: paper-26.2-build-84-v1\nverification:\n  status: verified\n',
  );
  await writeFile(
    join(root, 'dist', 'content', 'compatibility', 'paper-26.2-build-87-v1.yaml'),
    'id: paper-26.2-build-87-v1\nverification:\n  status: pending\n',
  );
  await writeFile(join(root, 'dist', 'content', 'bridge', 'mcpdev-bridge.jar'), 'jar');
  await writeFile(join(root, 'dist', 'supervisor', 'src', 'main.js'), '// svc');
  await writeFile(join(root, 'dist', 'mcp-server', 'src', 'index.js'), '// mcp');
  return root;
}

describe('mcpdev layout: standalone detection', () => {
  test('STANDALONE marker varsa standalone düzeni döner ve content yollarını çözer', async () => {
    const root = await makeStandaloneRoot({});
    const layout = detectLayoutFrom(join(root, 'dist', 'cli', 'src'));
    assert.equal(layout.kind, 'standalone');
    assert.equal(layout.root, root);
    assert.equal(layout.contentRoot, join(root, 'dist', 'content'));
    assert.equal(layout.bridgeJarPath, join(root, 'dist', 'content', 'bridge', 'mcpdev-bridge.jar'));
    assert.equal(layout.supervisorEntry, join(root, 'dist', 'supervisor', 'src', 'main.js'));
    assert.equal(layout.mcpServerEntry, join(root, 'dist', 'mcp-server', 'src', 'index.js'));
  });

  test('dataDir $MCPDEV_DATA_DIR env ile ezilir; yoksa ~/.mcpdev', async () => {
    const previous = process.env.MCPDEV_DATA_DIR;
    try {
      process.env.MCPDEV_DATA_DIR = join(tmpdir(), 'mcpdev-data-test');
      const root = await makeStandaloneRoot({});
      const layout = detectLayoutFrom(join(root, 'dist', 'cli', 'src'));
      assert.equal(layout.dataDir, process.env.MCPDEV_DATA_DIR);
    } finally {
      if (previous === undefined) delete process.env.MCPDEV_DATA_DIR;
      else process.env.MCPDEV_DATA_DIR = previous;
    }
  });

  test('marker yoksa (üst dizinlerde de) workspace düzeni döner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'layout-ws-'));
    const layout = detectLayoutFrom(join(dir, 'apps', 'cli', 'dist', 'src'));
    assert.equal(layout.kind, 'workspace');
    // 4 seviye yukarı = tmpdir; repo-root semantiği import.meta kaynaklı değil.
    assert.equal(layout.contentRoot, dir);
  });
});

describe('mcpdev layout: firstProfileId', () => {
  test('verified profil öncelikli döner', async () => {
    const root = await makeStandaloneRoot({});
    assert.equal(firstProfileId(join(root, 'dist', 'content')), 'paper-26.2-build-84-v1');
  });

  test('verified yoksa ilk .yaml döner', async () => {
    const root = await makeStandaloneRoot({});
    await mkdir(join(root, 'dist', 'content2', 'compatibility'), { recursive: true });
    await writeFile(
      join(root, 'dist', 'content2', 'compatibility', 'dev-build-v1.yaml'),
      'id: dev-build-v1\n',
    );
    assert.equal(firstProfileId(join(root, 'dist', 'content2')), 'dev-build-v1');
  });

  test('compatibility dizini yoksa undefined döner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'layout-empty-'));
    assert.equal(firstProfileId(root), undefined);
  });
});