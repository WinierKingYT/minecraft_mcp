/**
 * mcpdev doctor — health checks and diagnostic reporting.
 *
 * Runs a series of checks against the local environment and reports
 * pass/fail/warn for each. Output is human-readable by default, JSON with --json.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface DoctorOptions {
  readonly json: boolean;
  readonly verbose: boolean;
  readonly root?: string | undefined;
}

export interface CheckResult {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'warn' | 'skip';
  readonly message: string;
  readonly details?: string;
}

// ─── Individual checks ─────────────────────────────────────────────────

async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.versions.node;
  const major = Number.parseInt(version.split('.')[0]!, 10);

  if (major >= 22) {
    return { name: 'node_version', status: 'pass', message: `Node.js ${version}` };
  }
  return {
    name: 'node_version',
    status: 'fail',
    message: `Node.js ${version} (requires >= 22)`,
    details: 'Install Node.js 22+ from https://nodejs.org',
  };
}

async function checkJava(): Promise<CheckResult> {
  try {
    const { stderr } = await execFileAsync('java', ['-version'], { timeout: 10_000 });
    const match = /version "([^"]+)"/.exec(stderr);
    if (!match?.[1]) {
      return { name: 'java', status: 'warn', message: 'Java found but version unknown' };
    }
    const raw = match[1];
    let major: number;
    const legacy = /^1\.(\d+)/.exec(raw);
    if (legacy?.[1]) {
      major = Number.parseInt(legacy[1], 10);
    } else {
      const modern = /^(\d+)/.exec(raw);
      major = modern?.[1] ? Number.parseInt(modern[1], 10) : 0;
    }

    if (major >= 21) {
      return { name: 'java', status: 'pass', message: `Java ${raw} (major ${major})` };
    }
    return {
      name: 'java',
      status: 'warn',
      message: `Java ${raw} (major ${major}); Paper 26.x requires Java 21+`,
      details: 'Install Temurin 21+ from https://adoptium.net',
    };
  } catch {
    return {
      name: 'java',
      status: 'fail',
      message: 'Java not found on PATH',
      details: 'Install Java 21+ from https://adoptium.net',
    };
  }
}

async function checkPnpm(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync('pnpm', ['--version'], { timeout: 5_000 });
    const version = stdout.trim();
    return { name: 'pnpm', status: 'pass', message: `pnpm ${version}` };
  } catch {
    return {
      name: 'pnpm',
      status: 'fail',
      message: 'pnpm not found on PATH',
      details: 'Install pnpm: npm install -g pnpm',
    };
  }
}

function checkProjectRoot(root: string): CheckResult {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) {
    return {
      name: 'project_root',
      status: 'fail',
      message: `No package.json found in ${root}`,
      details: 'Run mcpdev doctor from the project root',
    };
  }

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const name = pkg['name'] ?? 'unknown';
    return { name: 'project_root', status: 'pass', message: `Project: ${name}` };
  } catch {
    return {
      name: 'project_root',
      status: 'warn',
      message: 'package.json exists but could not be parsed',
    };
  }
}

function checkCompatibilityProfile(root: string): CheckResult {
  const profileDir = join(root, 'compatibility');
  if (!existsSync(profileDir)) {
    return {
      name: 'compatibility_profile',
      status: 'warn',
      message: 'No compatibility/ directory found',
      details: 'Create a compatibility profile for your Paper version',
    };
  }

  const yamlFiles = readdirSync(profileDir).filter((f) => f.endsWith('.yaml'));
  if (yamlFiles.length === 0) {
    return {
      name: 'compatibility_profile',
      status: 'warn',
      message: 'No .yaml profiles found in compatibility/',
    };
  }

  // Check if any profile is verified
  for (const file of yamlFiles) {
    const content = readFileSync(join(profileDir, file), 'utf-8');
    if (content.includes('status: verified')) {
      return {
        name: 'compatibility_profile',
        status: 'pass',
        message: `Verified profile: ${file}`,
      };
    }
  }

  return {
    name: 'compatibility_profile',
    status: 'warn',
    message: `${yamlFiles.length} profile(s) found, none verified`,
    details: 'Run verify-compatibility to verify profiles',
  };
}

function checkMcpServerBinary(): CheckResult {
  // Check if the MCP Server binary exists
  const possiblePaths = [
    join(process.cwd(), '..', 'mcp-server', 'dist', 'src', 'index.js'),
    join(process.cwd(), 'node_modules', '.bin', 'minecraft-plugin-dev-mcp'),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return { name: 'mcp_server_binary', status: 'pass', message: 'MCP Server binary found' };
    }
  }

  return {
    name: 'mcp_server_binary',
    status: 'warn',
    message: 'MCP Server binary not found in expected locations',
    details: 'Run pnpm build to compile the MCP Server',
  };
}

function checkSupervisorBinary(): CheckResult {
  const possiblePaths = [
    join(process.cwd(), '..', 'run-supervisor', 'dist', 'src', 'index.js'),
    join(process.cwd(), 'node_modules', '.bin', 'mcpdev-supervisor'),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return { name: 'supervisor_binary', status: 'pass', message: 'Run Supervisor binary found' };
    }
  }

  return {
    name: 'supervisor_binary',
    status: 'warn',
    message: 'Run Supervisor binary not found in expected locations',
    details: 'Run pnpm build to compile the Run Supervisor',
  };
}

function checkBridgeJar(root: string): CheckResult {
  const possiblePaths = [
    join(root, 'bridge', 'paper', 'build', 'libs', 'paper-*.jar'),
    join(root, 'bridge', 'paper', 'build', 'libs'),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return { name: 'bridge_jar', status: 'pass', message: 'Bridge JAR found' };
    }
  }

  return {
    name: 'bridge_jar',
    status: 'warn',
    message: 'Bridge JAR not found',
    details: 'Run Gradle build in bridge/paper/ to compile the Bridge',
  };
}

// ─── Doctor runner ─────────────────────────────────────────────────────

export async function runDoctor(options: DoctorOptions): Promise<void> {
  const root = options.root ?? process.cwd();

  const checks: CheckResult[] = [];

  // Run checks sequentially (some depend on environment state)
  checks.push(checkProjectRoot(root));
  checks.push(await checkNodeVersion());
  checks.push(await checkJava());
  checks.push(await checkPnpm());
  checks.push(checkCompatibilityProfile(root));
  checks.push(checkMcpServerBinary());
  checks.push(checkSupervisorBinary());
  checks.push(checkBridgeJar(root));

  if (options.json) {
    const output = {
      timestamp: new Date().toISOString(),
      root,
      checks,
      summary: {
        total: checks.length,
        pass: checks.filter((c) => c.status === 'pass').length,
        fail: checks.filter((c) => c.status === 'fail').length,
        warn: checks.filter((c) => c.status === 'warn').length,
        skip: checks.filter((c) => c.status === 'skip').length,
      },
    };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(checks.some((c) => c.status === 'fail') ? 1 : 0);
    return;
  }

  // Human-readable output
  const icons: Record<string, string> = {
    pass: '\x1b[32m✔\x1b[0m',
    fail: '\x1b[31m✖\x1b[0m',
    warn: '\x1b[33m⚠\x1b[0m',
    skip: '\x1b[90m-\x1b[0m',
  };

  process.stdout.write('\x1b[1mmcpdev doctor\x1b[0m\n\n');

  for (const check of checks) {
    const icon = icons[check.status] ?? '?';
    process.stdout.write(`  ${icon} ${check.name}: ${check.message}\n`);
    if (options.verbose && check.details) {
      process.stdout.write(`    \x1b[90m${check.details}\x1b[0m\n`);
    }
  }

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;

  process.stdout.write('\n');
  process.stdout.write(
    `  \x1b[1m${passCount} passed\x1b[0m, ` +
    `${failCount} failed, ` +
    `${warnCount} warnings\n`,
  );

  if (failCount > 0) {
    process.stdout.write('\n  Fix the issues above and run \x1b[1mmcpdev doctor\x1b[0m again.\n');
  } else if (warnCount > 0) {
    process.stdout.write('\n  Warnings are non-blocking but may affect functionality.\n');
  } else {
    process.stdout.write('\n  All checks passed!\n');
  }

  process.exit(failCount > 0 ? 1 : 0);
}
