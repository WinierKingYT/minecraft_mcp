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

interface RootPackageJson {
  readonly engines?: { node?: unknown };
  readonly packageManager?: unknown;
}

function readRootPackageJson(root: string): RootPackageJson {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return {};
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8')) as RootPackageJson;
  } catch {
    return {};
  }
}

/** Verified profilin `java.runtime_major` değeri; yoksa null. */
function readProfileJavaMajor(root: string): number | null {
  const profileDir = join(root, 'compatibility');
  if (!existsSync(profileDir)) return null;
  for (const file of readdirSync(profileDir).filter((f) => f.endsWith('.yaml'))) {
    const content = readFileSync(join(profileDir, file), 'utf-8');
    if (!content.includes('status: verified')) continue;
    const match = /runtime_major:\s*(\d+)/.exec(content);
    if (match?.[1]) return Number.parseInt(match[1], 10);
  }
  return null;
}

/**
 * Pin kontrolü (ADR-0009): pin `X.Y.Z` ise major `X` + minor `>= Y` kabul
 * edilir — aynı LTS minor hattındaki güvenlik yamaları yeni ADR gerektirmez.
 * Yalnızca major biliniyorsa tam eşleşme aranır.
 */
function matchesPin(actual: string, pin: string): { ok: boolean; message: string } {
  const toParts = (v: string): Array<number | null> =>
    v.split('.', 2).map((p) => (p === '' ? null : Number.parseInt(p, 10)));
  const a = toParts(actual);
  const p = toParts(pin);
  if (p[0] !== null && a[0] !== p[0]) {
    return { ok: false, message: `sürüm majörü pin'den farklı (pin ${pin})` };
  }
  if (p[1] !== null && a[1] !== null && (a[1] as number) < (p[1] as number)) {
    return { ok: false, message: `minor pin'den düşük (pin ${pin})` };
  }
  return { ok: true, message: `pin ile uyumlu (pin ${pin})` };
}

// ─── Individual checks ─────────────────────────────────────────────────

export async function checkNodeVersion(root: string): Promise<CheckResult> {
  const version = process.versions.node;
  const pin = readRootPackageJson(root).engines?.node;

  if (typeof pin === 'string' && pin.trim() !== '') {
    const match = matchesPin(version, pin.trim());
    if (match.ok) {
      return { name: 'node_version', status: 'pass', message: `Node.js ${version} — ${match.message}` };
    }
    return {
      name: 'node_version',
      status: 'fail',
      message: `Node.js ${version} — ${match.message}`,
      details: `Install Node.js ${pin.trim()} (pin: engines.node, ADR-0009)`,
    };
  }

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

export async function checkJava(root: string): Promise<CheckResult> {
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

    const pinnedMajor = readProfileJavaMajor(root);
    if (pinnedMajor !== null) {
      if (major === pinnedMajor) {
        return { name: 'java', status: 'pass', message: `Java ${raw} (major ${major}) — profil pin'i ${pinnedMajor}` };
      }
      return {
        name: 'java',
        status: 'fail',
        message: `Java ${raw} (major ${major}); profil ${pinnedMajor} gerektiriyor`,
        details: `Install Temurin ${pinnedMajor}+ from https://adoptium.net`,
      };
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

export async function checkPnpm(root: string): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync('pnpm', ['--version'], { timeout: 5_000 });
    const version = stdout.trim();
    const pinRaw = readRootPackageJson(root).packageManager;
    const pin = typeof pinRaw === 'string' ? /^pnpm@(.+)$/.exec(pinRaw)?.[1] : undefined;
    if (pin) {
      const match = matchesPin(version, pin);
      if (match.ok) {
        return { name: 'pnpm', status: 'pass', message: `pnpm ${version} — ${match.message}` };
      }
      return {
        name: 'pnpm',
        status: 'fail',
        message: `pnpm ${version} — ${match.message}`,
        details: `Install pnpm ${pin} (pin: packageManager)`,
      };
    }
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

function checkMcpServerBinary(root: string): CheckResult {
  const possiblePaths = [
    join(root, 'apps', 'mcp-server', 'dist', 'src', 'index.js'),
    join(root, 'node_modules', '.bin', 'minecraft-plugin-dev-mcp'),
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

function checkSupervisorBinary(root: string): CheckResult {
  const possiblePaths = [
    join(root, 'apps', 'run-supervisor', 'dist', 'src', 'main.js'),
    join(root, 'node_modules', '.bin', 'mcpdev-supervisor'),
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

export function checkSecondProfile(root: string): CheckResult {
  // V1.1: birden fazla uyumluluk profili (ör. ikinci Paper build'i) tanımlı
  // olmalı; diverjans Gateway'in multi-profile desteğine bağlıdır.
  const profileDir = join(root, 'compatibility');
  if (!existsSync(profileDir)) {
    return { name: 'compatibility_profiles', status: 'skip', message: 'compatibility/ yok' };
  }

  const yamlFiles = readdirSync(profileDir).filter((f) => f.endsWith('.yaml'));
  const verifiedCount = yamlFiles.filter((f) =>
    readFileSync(join(profileDir, f), 'utf-8').includes('status: verified'),
  ).length;

  if (verifiedCount < 2) {
    return {
      name: 'compatibility_profiles',
      status: 'warn',
      message: `${verifiedCount}/2 profil doğrulandı (V1.1 diverge gerektirir)`,
      details: 'V1.1 multi-profile: en az iki verified profil tanımlayın',
    };
  }
  return {
    name: 'compatibility_profiles',
    status: 'pass',
    message: `${verifiedCount} verified profil`,
  };
}

export function checkCapabilityRegistry(root: string): CheckResult {
  const capDir = join(root, 'packages', 'capability-registry', 'capabilities');
  if (!existsSync(capDir)) {
    return { name: 'capability_registry', status: 'skip', message: 'capability-registry yok' };
  }
  const capabilityFiles = readdirSync(capDir).filter((f) => f.endsWith('.yaml'));
  if (capabilityFiles.length === 0) {
    return { name: 'capability_registry', status: 'warn', message: 'capability kaydı yok' };
  }
  return {
    name: 'capability_registry',
    status: 'pass',
    message: `${capabilityFiles.length} capability kaydı`,
  };
}

function checkBridgeJar(root: string): CheckResult {
  const libsDir = join(root, 'bridge', 'paper', 'build', 'libs');
  if (existsSync(libsDir)) {
    const jars = readdirSync(libsDir).filter((f) => f.endsWith('.jar'));
    if (jars.length > 0) {
      return { name: 'bridge_jar', status: 'pass', message: `Bridge JAR found (${jars.length})` };
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
  checks.push(await checkNodeVersion(root));
  checks.push(await checkJava(root));
  checks.push(await checkPnpm(root));
  checks.push(checkCompatibilityProfile(root));
  checks.push(checkMcpServerBinary(root));
  checks.push(checkSupervisorBinary(root));
  checks.push(checkBridgeJar(root));
  checks.push(checkSecondProfile(root));
  checks.push(checkCapabilityRegistry(root));

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
