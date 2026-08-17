/**
 * mcpdev layout — self-location (workspace repo vs standalone npm paketi).
 *
 * Phase 2 (tek npm paketi): aynı CLI iki düzende çalışır —
 *   1. workspace düzeni: repo kökü (`apps/cli/dist/src` → repo root).
 *   2. standalone düzeni: `mcpdev` paketi (kökte STANDALONE marker'ı; content
 *      `dist/content` altında gömülü).
 *
 * Content kökü her iki düzende de `compatibility/` + `fixtures/manifests/`
 * taşır; supervisor `--repo-root <contentRoot>` ile bu dizine işaret eder ve
 * mevcut yollar değişmeden çalışır. Kalıcı veri (EULA, registry, evidence,
 * paper-cache, artifacts) standalone'da asla paket içine yazılmaz — kullanıcı
 * veri köküne (`$MCPDEV_DATA_DIR` veya `~/.mcpdev`) yazılır.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type InstallLayout = 'workspace' | 'standalone';

export interface McpdevLayout {
  readonly kind: InstallLayout;
  /** Dağıtım kökü: standalone paket kökü veya repo kökü. */
  readonly root: string;
  /** Content kökü: compatibility/ + fixtures/manifests/ barındırır. */
  readonly contentRoot: string;
  /** Bridge JAR yolu (deterministik ad: mcpdev-bridge.jar). */
  readonly bridgeJarPath: string;
  /** Supervisor giriş noktası. */
  readonly supervisorEntry: string;
  /** MCP Server giriş noktası. */
  readonly mcpServerEntry: string;
  /** Kullanıcı veri kökü: $MCPDEV_DATA_DIR veya ~/.mcpdev. */
  readonly dataDir: string;
}

function ancestorDirs(start: string): string[] {
  const dirs: string[] = [];
  let current = resolve(start);
  for (;;) {
    dirs.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

/** Content kökündeki verified profilin id'si; yoksa ilk .yaml; yoksa undefined. */
export function firstProfileId(contentRoot: string): string | undefined {
  const profileDir = join(contentRoot, 'compatibility');
  if (!existsSync(profileDir)) return undefined;
  const yamlFiles = readdirSync(profileDir).filter((f) => f.endsWith('.yaml'));
  if (yamlFiles.length === 0) return undefined;
  const verified = yamlFiles.find((f) => {
    try {
      return readFileSync(join(profileDir, f), 'utf8').includes('status: verified');
    } catch {
      return false;
    }
  });
  return (verified ?? yamlFiles[0])?.replace(/\.yaml$/, '');
}

/** Workspace bridge JAR'ı: build/libs içindeki ilk (sources olmayan) jar. */
function workspaceBridgeJar(repoRoot: string): string {
  const libsDir = join(repoRoot, 'bridge', 'paper', 'build', 'libs');
  if (!existsSync(libsDir)) return '';
  const jar = readdirSync(libsDir).find(
    (f) => f.endsWith('.jar') && !f.endsWith('-sources.jar'),
  );
  return jar ? join(libsDir, jar) : '';
}

/**
 * Çalışma düzenini tespit eder. Standalone, paket kökündeki STANDALONE
 * marker'ı ile tanınır; marker yoksa workspace düzeni varsayılır.
 */
export function detectLayout(): McpdevLayout {
  return detectLayoutFrom(import.meta.dirname);
}

/** Test edilebilir varyant: verilen giriş (derlenmiş cli) dizininden tespit. */
export function detectLayoutFrom(entryDir: string): McpdevLayout {
  for (const dir of ancestorDirs(entryDir)) {
    if (existsSync(join(dir, 'STANDALONE'))) {
      const contentRoot = join(dir, 'dist', 'content');
      return {
        kind: 'standalone',
        root: dir,
        contentRoot,
        bridgeJarPath: join(contentRoot, 'bridge', 'mcpdev-bridge.jar'),
        supervisorEntry: join(dir, 'dist', 'supervisor', 'src', 'main.js'),
        mcpServerEntry: join(dir, 'dist', 'mcp-server', 'src', 'index.js'),
        dataDir: process.env.MCPDEV_DATA_DIR ?? join(homedir(), '.mcpdev'),
      };
    }
  }
  // Workspace: entry'den 4 seviye yukarı repo kökü (dist/src → repo).
  const root = resolve(entryDir, '..', '..', '..', '..');
  return {
    kind: 'workspace',
    root,
    contentRoot: root,
    bridgeJarPath: workspaceBridgeJar(root),
    supervisorEntry: join(root, 'apps', 'run-supervisor', 'dist', 'src', 'main.js'),
    mcpServerEntry: join(root, 'apps', 'mcp-server', 'dist', 'src', 'index.js'),
    dataDir: process.env.MCPDEV_DATA_DIR ?? join(homedir(), '.mcpdev'),
  };
}
