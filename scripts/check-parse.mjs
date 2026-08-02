#!/usr/bin/env node
// DOC-GATE-03 — Repository'deki tüm JSON ve YAML dosyaları parse edebilmelidir.
// Ayrıca markdown içindeki ```json ve ```yaml blokları da denetlenir: belgedeki
// örneklerin bozuk olması, sözleşme belgesinin güvenilirliğini düşürür.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ROOT, fail, ok } from './lib/registry.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.gradle', 'coverage', 'runtimes', 'evidence']);
const errors = [];
let files = 0;
let blocks = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    const ext = extname(entry);
    const rel = relative(ROOT, full);

    try {
      if (ext === '.json') {
        JSON.parse(readFileSync(full, 'utf8'));
        files++;
      } else if (ext === '.yaml' || ext === '.yml') {
        parseYaml(readFileSync(full, 'utf8'));
        files++;
      } else if (ext === '.md') {
        checkMarkdown(full, rel);
        files++;
      }
    } catch (err) {
      errors.push(`${rel}: ${err.message}`);
    }
  }
}

function checkMarkdown(full, rel) {
  const content = readFileSync(full, 'utf8');
  const fence = /```(json|yaml|yml)\n([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(content)) !== null) {
    const [, lang, body] = m;
    const line = content.slice(0, m.index).split('\n').length;
    blocks++;
    try {
      if (lang === 'json') JSON.parse(body);
      else parseYaml(body);
    } catch (err) {
      errors.push(`${rel}:${line} (${lang} bloğu): ${err.message}`);
    }
  }
}

walk(ROOT);

if (errors.length) fail(errors);
ok(`${files} dosya, ${blocks} gömülü kod bloğu parse edildi.`);
