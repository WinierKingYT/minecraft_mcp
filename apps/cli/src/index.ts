/**
 * mcpdev CLI — unified entry point for install and doctor commands.
 *
 * Uses node:util.parseArgs (no external dependencies).
 */

import { parseArgs } from 'node:util';
import { runDoctor } from './doctor.js';
import { runInstall } from './install.js';
import { runUninstall } from './uninstall.js';

const HELP = `Usage: mcpdev <command> [options]

Commands:
  install   Set up MCP development infrastructure
  uninstall Remove MCP development artifacts
  doctor    Run health checks and report status

Options:
  --help       Show this help message
  --version    Show version
  --json       Output as JSON (doctor/uninstall)
  --verbose    Show detailed output (doctor only)
  --root <path>  Project root directory (default: current directory)
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
    default:
      process.stderr.write(`Unknown command: ${command ?? '(none)'}\n\n${HELP}`);
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
