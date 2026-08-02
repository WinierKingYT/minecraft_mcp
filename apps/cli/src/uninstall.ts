/**
 * mcpdev uninstall — remove MCP development infrastructure artifacts.
 *
 * Removes build outputs, generated files, and runtime directories.
 * Does NOT remove source code, configs, or lock files.
 */

import { existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface UninstallOptions {
  readonly root?: string | undefined;
  readonly json?: boolean | undefined;
}

interface StepResult {
  readonly name: string;
  readonly status: 'done' | 'skip' | 'fail';
  readonly message: string;
  readonly bytesRemoved?: number;
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        total += dirSize(full);
      } else {
        total += statSync(full).size;
      }
    }
  } catch {
    // ignore
  }
  return total;
}

function removeDir(dir: string): { removed: boolean; bytes: number } {
  if (!existsSync(dir)) return { removed: false, bytes: 0 };
  const bytes = dirSize(dir);
  try {
    rmSync(dir, { recursive: true, force: true });
    return { removed: true, bytes };
  } catch {
    return { removed: false, bytes: 0 };
  }
}

function removeGlob(pattern: string, root: string): { removed: boolean; bytes: number } {
  // Simple glob: match files ending with pattern suffix
  const dir = root;
  let totalBytes = 0;
  let removed = false;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(pattern)) {
        const full = join(dir, entry.name);
        const size = statSync(full).size;
        rmSync(full, { force: true });
        totalBytes += size;
        removed = true;
      }
    }
  } catch {
    // ignore
  }
  return { removed, bytes: totalBytes };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]!}`;
}

export async function runUninstall(options: UninstallOptions): Promise<void> {
  const root = options.root ?? process.cwd();
  const json = options.json ?? false;
  const steps: StepResult[] = [];

  if (!json) {
    process.stdout.write('\x1b[1mmcpdev uninstall\x1b[0m\n\n');
  }

  // Verify project root
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) {
    process.stderr.write(`  \x1b[31m✖\x1b[0m Not a valid project root: ${root}\n`);
    process.exit(1);
  }

  // Directories to remove
  const dirsToRemove = [
    'node_modules',
    'apps/mcp-server/dist',
    'apps/run-supervisor/dist',
    'apps/cli/dist',
    'bridge/paper/build',
    'packages/contracts/dist',
    'packages/capability-registry/dist',
    'packages/error-catalog/dist',
  ];

  for (const relDir of dirsToRemove) {
    const dir = join(root, relDir);
    const { removed, bytes } = removeDir(dir);
    if (removed) {
      steps.push({ name: relDir, status: 'done', message: `Removed ${relDir}`, bytesRemoved: bytes });
    } else {
      steps.push({ name: relDir, status: 'skip', message: `Not found: ${relDir}` });
    }
  }

  // Remove generated files
  const genFiles = [
    'packages/error-catalog/generated/errors.json',
    'packages/contracts/generated/bridge-protocol.json',
    'packages/contracts/generated/mcp-bridge-schema.json',
  ];

  for (const relFile of genFiles) {
    const file = join(root, relFile);
    if (existsSync(file)) {
      const size = statSync(file).size;
      rmSync(file, { force: true });
      steps.push({ name: relFile, status: 'done', message: `Removed ${relFile}`, bytesRemoved: size });
    } else {
      steps.push({ name: relFile, status: 'skip', message: `Not found: ${relFile}` });
    }
  }

  // Remove SBOM
  const { removed: sbomRemoved, bytes: sbomBytes } = removeGlob('sbom.json', root);
  if (sbomRemoved) {
    steps.push({ name: 'sbom', status: 'done', message: 'Removed sbom.json', bytesRemoved: sbomBytes });
  }

  // Print results
  if (json) {
    const output = {
      command: 'uninstall',
      root,
      steps,
      totalRemoved: steps.filter((s) => s.status === 'done').length,
      totalSkipped: steps.filter((s) => s.status === 'skip').length,
      totalFailed: steps.filter((s) => s.status === 'fail').length,
      totalBytes: steps.reduce((sum, s) => sum + (s.bytesRemoved ?? 0), 0),
    };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } else {
    const icons: Record<string, string> = {
      done: '\x1b[32m✔\x1b[0m',
      skip: '\x1b[90m-\x1b[0m',
      fail: '\x1b[31m✖\x1b[0m',
    };

    for (const step of steps) {
      const sizeStr = step.bytesRemoved ? ` (${formatBytes(step.bytesRemoved)})` : '';
      process.stdout.write(`  ${icons[step.status]!} ${step.message}${sizeStr}\n`);
    }

    const totalBytes = steps.reduce((sum, s) => sum + (s.bytesRemoved ?? 0), 0);
    process.stdout.write(`\n  \x1b[32mUninstall complete!\x1b[0m Removed ${formatBytes(totalBytes)}.\n`);
    process.stdout.write('  Run \x1b[1mmcpdev install\x1b[0m to set up again.\n');
  }
}
