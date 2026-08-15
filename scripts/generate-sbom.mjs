/**
 * SBOM generation script — produces a CycloneDX-like SBOM covering
 * both Node.js (pnpm) and Java (Gradle) dependencies.
 *
 * Usage: node scripts/generate-sbom.mjs [--output <path>]
 *
 * Output: sbom.json in project root (or custom path).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { parsePnpmLockfile, parseGradleLockfile } from './lib/lockfiles.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Argument parsing ──────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    output: { type: 'string', short: 'o' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  process.stdout.write(`Usage: node scripts/generate-sbom.mjs [--output <path>]

Generates a CycloneDX-like SBOM covering Node.js and Java dependencies.
Output defaults to ./sbom.json
`);
  process.exit(0);
}

// ─── Read project metadata ─────────────────────────────────────────────

function readProjectVersion() {
  const pkgPath = join(ROOT, 'package.json');
  if (!existsSync(pkgPath)) return '0.0.0';
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg['version'] ?? '0.0.0';
}

function readProfileId() {
  const profileDir = join(ROOT, 'compatibility');
  if (!existsSync(profileDir)) return null;
  const files = readdirSync(profileDir).filter((f) => f.endsWith('.yaml'));
  for (const file of files) {
    const content = readFileSync(join(profileDir, file), 'utf-8');
    if (content.includes('status: verified')) {
      return file.replace('.yaml', '');
    }
  }
  return files[0]?.replace('.yaml', '') ?? null;
}

// ─── Main ──────────────────────────────────────────────────────────────

async function generateSBOM() {
  const version = readProjectVersion();
  const timestamp = new Date().toISOString();

  // Collect dependencies from all sources
  const nodeComponents = parsePnpmLockfile(join(ROOT, 'pnpm-lock.yaml'));
  const gradleComponents = parseGradleLockfile(join(ROOT, 'bridge', 'paper', 'gradle.lockfile'));

  const allComponents = [...nodeComponents, ...gradleComponents];

  // Compute total hash
  const contentHash = createHash('sha256')
    .update(JSON.stringify(allComponents))
    .digest('hex');

  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      timestamp,
      tools: [
        {
          vendor: 'mcpdev',
          name: 'generate-sbom',
          version: '0.1.0',
        },
      ],
      component: {
        type: 'application',
        name: 'minecraft-plugin-dev-mcp',
        version,
        description: 'Local development infrastructure for verifying AI-authored Paper plugins',
      },
      properties: [
        { name: 'sbom:total_components', value: String(allComponents.length) },
        { name: 'sbom:node_components', value: String(nodeComponents.length) },
        { name: 'sbom:java_components', value: String(gradleComponents.length) },
        { name: 'sbom:content_hash', value: contentHash },
      ],
    },
    components: allComponents,
    dependencies: [
      {
        ref: `minecraft-plugin-dev-mcp@${version}`,
        dependsOn: allComponents.map((c) => c.purl),
      },
    ],
  };

  const outputPath = values.output ?? join(ROOT, 'sbom.json');
  writeFileSync(outputPath, JSON.stringify(sbom, null, 2) + '\n');

  process.stdout.write(`SBOM generated: ${outputPath}\n`);
  process.stdout.write(`  Node.js components: ${nodeComponents.length}\n`);
  process.stdout.write(`  Java components:    ${gradleComponents.length}\n`);
  process.stdout.write(`  Total:              ${allComponents.length}\n`);
  process.stdout.write(`  Content hash:       ${contentHash}\n`);
}

generateSBOM().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
