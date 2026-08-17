/**
 * mcpdev install — set up MCP development infrastructure.
 *
 * Workspace düzeni: dizin yapısını oluşturur, ön koşulları doğrular, pnpm
 * bağımlılıklarını kurar ve projeyi derler.
 *
 * Standalone düzeni (tek npm paketi): kullanıcı veri kökü (~/.mcpdev) altında
 * konfigürasyon/çalışma dizinlerini oluşturur; paket içeriği read-only olarak
 * kabul edilir (derleme/pnpm yok).
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectLayout } from './layout.js';

const execFileAsync = promisify(execFile);

export interface InstallOptions {
  readonly root?: string | undefined;
  readonly layout?: ReturnType<typeof detectLayout>;
}

interface StepResult {
  readonly name: string;
  readonly status: 'done' | 'skip' | 'fail';
  readonly message: string;
}

async function execCommand(cmd: string, args: string[], cwd: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd,
    timeout: 120_000,
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  return `${stdout}\n${stderr}`;
}

/** Standalone: kullanıcı veri kökü altında çalışma dizinlerini hazırlar. */
function installStandalone(layout: { dataDir: string }): StepResult[] {
  const steps: StepResult[] = [];
  const dirs = [
    join(layout.dataDir, 'config'),
    join(layout.dataDir, 'paper-cache'),
    join(layout.dataDir, 'artifacts'),
    join(layout.dataDir, 'evidence'),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      steps.push({ name: 'data-dir', status: 'done', message: `Created ${dir}` });
    } else {
      steps.push({ name: 'data-dir', status: 'skip', message: `Exists ${dir}` });
    }
  }
  return steps;
}

export async function runInstall(options: InstallOptions): Promise<void> {
  const layout = options.layout ?? detectLayout();

  process.stdout.write('\x1b[1mmcpdev install\x1b[0m\n\n');

  if (layout.kind === 'standalone') {
    const steps = installStandalone(layout);
    const icons: Record<string, string> = {
      done: '\x1b[32m✔\x1b[0m',
      skip: '\x1b[90m-\x1b[0m',
      fail: '\x1b[31m✖\x1b[0m',
    };
    for (const step of steps) {
      process.stdout.write(`  ${icons[step.status]!} ${step.message}\n`);
    }
    process.stdout.write('\n  \x1b[32mInstall complete!\x1b[0m\n');
    process.stdout.write('  Run \x1b[1mmcpdev doctor\x1b[0m to verify the setup.\n');
    return;
  }

  const root = options.root ?? process.cwd();
  const steps: StepResult[] = [];

  process.stdout.write(`  Layout: workspace (${root})\n\n`);

  // Step 1: Verify project root
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) {
    process.stderr.write(`  \x1b[31m✖\x1b[0m Not a valid project root: ${root}\n`);
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  process.stdout.write(`  Project: ${pkg['name'] ?? 'unknown'}\n\n`);

  // Step 2: Create required directories
  const dirs = [
    join(root, 'compatibility'),
    join(root, 'fixtures', 'worlds'),
    join(root, 'fixtures', 'projects'),
    join(root, 'fixtures', 'plugins'),
    join(root, 'fixtures', 'malicious', 'scenarios'),
    join(root, 'fixtures', 'malicious', 'plugins'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      steps.push({ name: 'directories', status: 'done', message: `Created ${dir.replace(root, '.')}` });
    } else {
      steps.push({ name: 'directories', status: 'skip', message: `Exists ${dir.replace(root, '.')}` });
    }
  }

  // Step 3: Verify Node.js version
  const nodeVersion = process.versions.node;
  const nodeMajor = Number.parseInt(nodeVersion.split('.')[0]!, 10);
  if (nodeMajor >= 22) {
    steps.push({ name: 'node', status: 'done', message: `Node.js ${nodeVersion}` });
  } else {
    steps.push({ name: 'node', status: 'fail', message: `Node.js ${nodeVersion} (requires >= 22)` });
  }

  // Step 4: Verify Java
  try {
    const { stderr } = await execFileAsync('java', ['-version'], { timeout: 10_000 });
    const match = /version "([^"]+)"/.exec(stderr);
    steps.push({
      name: 'java',
      status: 'done',
      message: `Java ${match?.[1] ?? 'unknown'}`,
    });
  } catch {
    steps.push({ name: 'java', status: 'fail', message: 'Java not found on PATH' });
  }

  // Step 5: Install dependencies
  // Frozen-lockfile'ın başarısız olması repository bütünlük problemidir;
  // fallback yoktur (contributor, lockfile'ı güncelleyip commit etmelidir).
  try {
    await execCommand('pnpm', ['install', '--frozen-lockfile'], root);
    steps.push({ name: 'dependencies', status: 'done', message: 'Dependencies installed' });
  } catch (err) {
    steps.push({
      name: 'dependencies',
      status: 'fail',
      message: 'LOCKFILE_OUT_OF_DATE: package.json ile pnpm-lock.yaml uyuşmuyor. '
        + 'Contributor olarak `pnpm install` çalıştırın ve lockfile değişikliğini commit edin. '
        + `Detay: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Step 6: Build project
  try {
    await execCommand('pnpm', ['run', 'build'], root);
    steps.push({ name: 'build', status: 'done', message: 'Project built successfully' });
  } catch (err) {
    steps.push({
      name: 'build',
      status: 'fail',
      message: `Build failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Step 7: Generate contracts
  if (existsSync(join(root, 'scripts', 'generate-contracts.mjs'))) {
    try {
      await execCommand('node', ['scripts/generate-contracts.mjs'], root);
      steps.push({ name: 'contracts', status: 'done', message: 'Contracts generated' });
    } catch {
      steps.push({ name: 'contracts', status: 'skip', message: 'Contract generation skipped' });
    }
  }

  // Print results
  const icons: Record<string, string> = {
    done: '\x1b[32m✔\x1b[0m',
    skip: '\x1b[90m-\x1b[0m',
    fail: '\x1b[31m✖\x1b[0m',
  };

  for (const step of steps) {
    process.stdout.write(`  ${icons[step.status]!} ${step.message}\n`);
  }

  const failCount = steps.filter((s) => s.status === 'fail').length;
  process.stdout.write('\n');

  if (failCount > 0) {
    process.stdout.write('  \x1b[31mInstall completed with errors.\x1b[0m\n');
    process.stdout.write('  Fix the issues above and run \x1b[1mmcpdev install\x1b[0m again.\n');
    process.exit(1);
  } else {
    process.stdout.write('  \x1b[32mInstall complete!\x1b[0m\n');
    process.stdout.write('  Run \x1b[1mmcpdev doctor\x1b[0m to verify the setup.\n');
  }
}
