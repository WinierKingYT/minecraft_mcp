#!/usr/bin/env node
/**
 * mcpdev CLI — unified entry point for install, doctor and serve commands.
 *
 * Uses node:util.parseArgs (no external dependencies).
 */

import { parseArgs } from 'node:util';
import { runDoctor } from './doctor.js';
import { runInstall } from './install.js';
import { runUninstall } from './uninstall.js';
import { runServe } from './serve.js';
import { runEula } from './eula.js';

const HELP = `Usage: mcpdev <command> [options]

Commands:
  install   Set up MCP development infrastructure
  uninstall Remove MCP development artifacts
  doctor    Run health checks and report status
  serve     Start Supervisor + MCP Server (stdio) for an MCP client
  eula      Manage the Minecraft EULA acceptance (operator action)

Options:
  --help       Show this help message
  --version    Show version
  --json       Output as JSON (doctor/uninstall)
  --verbose    Show detailed output (doctor only)
  --root <path>  Project root directory (default: current directory)

eula subcommands:
  status       Show whether the Minecraft EULA has been accepted
  accept       Accept the Minecraft EULA (records a local, per-user decision)

serve options:
  --repo-root <path>       Repo root (MCPDEV_ROOT for mcp-server)
  --profile-id <id>        Compatibility profile id
  --bridge-jar <path>      Paper Bridge plugin JAR
  --paper-cache <dir>      Paper JAR cache directory
  --project-id <id>        Project id (registers the project; launcher surface)
  --project-root <path>    Project root (required together with --project-id)
  --registry-file <path>   Persistent project registry file
  --runtime-root <dir>     Runtime root directory
  --evidence-dir <dir>     Evidence store directory
  --eula-file <path>       EULA acceptance record (default: $MCPDEV_DATA_DIR/config/eula.json)
  --tool-profile <name>    MCP tool profile (default: developer)
  --log-level <level>      MCP server log level (ERROR|WARN|INFO|DEBUG)
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      json: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      root: { type: 'string', short: 'r' },
      'repo-root': { type: 'string' },
      'profile-id': { type: 'string' },
      'bridge-jar': { type: 'string' },
      'paper-cache': { type: 'string' },
      'project-id': { type: 'string' },
      'project-root': { type: 'string' },
      'registry-file': { type: 'string' },
      'runtime-root': { type: 'string' },
      'evidence-dir': { type: 'string' },
      'tool-profile': { type: 'string' },
      'log-level': { type: 'string' },
      'eula-file': { type: 'string' },
      'data-dir': { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  if (values.version) {
    // Read version from package.json
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8'));
    process.stdout.write(`${pkg['version']}\n`);
    process.exit(0);
  }

  const command = positionals[0];

  switch (command) {
    case 'doctor':
      await runDoctor({
        json: values.json ?? false,
        verbose: values.verbose ?? false,
        root: values.root as string | undefined,
      });
      break;
    case 'install':
      await runInstall({
        root: values.root as string | undefined,
      });
      break;
    case 'uninstall':
      await runUninstall({
        root: values.root as string | undefined,
        json: values.json ?? false,
      });
      break;
    case 'serve': {
      const required = ['repo-root', 'profile-id', 'bridge-jar', 'paper-cache'] as const;
      const missing = required.filter((key) => values[key] === undefined);
      if (missing.length > 0) {
        process.stderr.write(`serve: eksik zorunlu seçenekler: ${missing.join(', ')}\n`);
        process.exit(2);
      }
      const { exitCode } = await runServe({
        repoRoot: values['repo-root'] as string,
        profileId: values['profile-id'] as string,
        bridgeJarPath: values['bridge-jar'] as string,
        paperCacheDir: values['paper-cache'] as string,
        ...(values['project-id'] !== undefined ? { projectId: values['project-id'] as string } : {}),
        ...(values['project-root'] !== undefined ? { projectRoot: values['project-root'] as string } : {}),
        ...(values['registry-file'] !== undefined ? { registryFile: values['registry-file'] as string } : {}),
        ...(values['runtime-root'] !== undefined ? { runtimeRootDir: values['runtime-root'] as string } : {}),
        ...(values['evidence-dir'] !== undefined ? { evidenceDir: values['evidence-dir'] as string } : {}),
        ...(values['eula-file'] !== undefined ? { eulaFile: values['eula-file'] as string } : {}),
        ...(values['tool-profile'] !== undefined ? { toolProfile: values['tool-profile'] as string } : {}),
        ...(values['log-level'] !== undefined ? { logLevel: values['log-level'] as string } : {}),
      });
      process.exit(exitCode);
      break;
    }
    case 'eula': {
      const subcommand = positionals[1] ?? 'status';
      if (subcommand !== 'status' && subcommand !== 'accept') {
        process.stderr.write(`eula: bilinmeyen alt komut "${subcommand}" (status|accept)\n`);
        process.exit(2);
      }
      const { runEula } = await import('./eula.js');
      const exitCode = await runEula({
        command: subcommand,
        ...(values['profile-id'] !== undefined ? { profileId: values['profile-id'] as string } : {}),
        ...(values['data-dir'] !== undefined ? { dataDir: values['data-dir'] as string } : {}),
      });
      process.exit(exitCode);
      break;
    }
    default:
      process.stderr.write(`Unknown command: ${command ?? '(none)'}\n\n${HELP}`);
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
