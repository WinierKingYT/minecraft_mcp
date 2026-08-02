#!/usr/bin/env node

/**
 * generate-checksums.mjs — SHA-256 checksums for release artifacts.
 *
 * Scans the repository for release artifacts and generates a SHA-256
 * checksums file (checksums.sha256) in the project root.
 *
 * Usage: node scripts/generate-checksums.mjs [--output <path>]
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
let outputPath = resolve('checksums.sha256');

for (let i = 2; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) {
    outputPath = resolve(args[i + 1]);
    i++;
  }
}

// Artifact patterns to include
const ARTIFACT_PATTERNS = [
  'apps/mcp-server/dist/**/*.js',
  'apps/run-supervisor/dist/**/*.js',
  'apps/cli/dist/**/*.js',
  'bridge/paper/build/libs/**/*.jar',
  'packages/contracts/dist/**/*.js',
  'packages/capability-registry/dist/**/*.js',
  'packages/error-catalog/dist/**/*.js',
  'packages/error-catalog/generated/**/*.json',
  'packages/contracts/generated/**/*.json',
  'compatibility/*.yaml',
  'packages/capability-registry/capabilities/**/*.yaml',
  'packages/error-catalog/errors/**/*.yaml',
  'sbom.json',
];

function walkDir(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkDir(full));
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  } catch {
    // ignore
  }
  return files;
}

function matchPattern(filePath, pattern) {
  // Simple glob matching: convert pattern to regex
  const regex = new RegExp(
    '^' +
    pattern
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\{\{GLOBSTAR\}\}/g, '.*')
      .replace(/\./g, '\\.') +
    '$'
  );
  return regex.test(filePath);
}

function hashFile(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

// Collect all artifacts
const root = resolve('.');
const allFiles = walkDir(root);
const artifacts = [];

for (const file of allFiles) {
  const relPath = relative(root, file).replace(/\\/g, '/');
  for (const pattern of ARTIFACT_PATTERNS) {
    if (matchPattern(relPath, pattern)) {
      const size = statSync(file).size;
      const hash = hashFile(file);
      artifacts.push({ path: relPath, hash, size });
      break;
    }
  }
}

// Sort by path
artifacts.sort((a, b) => a.path.localeCompare(b.path));

// Generate checksums file
const lines = artifacts.map((a) => `${a.hash}  ${a.path}`);
const header = [
  '# SHA-256 checksums for release artifacts',
  `# Generated: ${new Date().toISOString()}`,
  `# Total artifacts: ${artifacts.length}`,
  '',
].join('\n');

writeFileSync(outputPath, header + lines.join('\n') + '\n');

// Summary
const totalSize = artifacts.reduce((sum, a) => sum + a.size, 0);
console.log(`Generated ${artifacts.length} checksums (${(totalSize / 1024).toFixed(1)} KB total)`);
console.log(`Output: ${outputPath}`);
