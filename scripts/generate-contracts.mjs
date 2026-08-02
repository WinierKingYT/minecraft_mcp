#!/usr/bin/env node
// Contract generation — capability registry ve error catalog tek gerçek kaynaktır.
//
// Üretilenler:
//   packages/generated-types/src/capabilities.generated.ts
//   packages/generated-types/src/errors.generated.ts
//   packages/generated-types/src/tool-profiles.generated.ts
//   bridge/paper/src/main/java/.../generated/BridgeOperation.java
//   bridge/paper/src/main/java/.../generated/ErrorCode.java
//   docs/contracts/capability-registry.md  (risk-matrix bloğu)
//   packages/contracts/schemas/scenario/scenario.schema.json (step-allowlist bloğu)
//
// --check ile hiçbir dosya yazılmaz; mevcut içerikle farklılık varsa çıkış kodu 1.
// Bu, elle düzenlenmiş generated dosyaların CI'da yakalanmasını sağlar.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadCapabilities, loadErrors, loadProfiles, PATHS, ROOT, fail, ok } from './lib/registry.mjs';

const CHECK = process.argv.includes('--check');
const HEADER = '// Bu dosya `pnpm run gen` tarafından üretilir. ELLE DÜZENLEMEYİN.\n';
const JAVA_PKG = 'io.github.mcpdev.bridge.generated';
const JAVA_DIR = join(ROOT, 'bridge', 'paper', 'src', 'main', 'java', 'io', 'github', 'mcpdev', 'bridge', 'generated');

const caps = loadCapabilities().map((c) => c.record);
const errs = loadErrors().map((e) => e.record);
const profiles = loadProfiles();

const pending = [];

function emit(file, content) {
  pending.push({ file, content });
}

// ---------------------------------------------------------------- TypeScript

const capIds = caps.map((c) => c.id).sort();
emit(
  join(PATHS.generated, 'capabilities.generated.ts'),
  HEADER +
    '\nexport const CAPABILITY_IDS = [\n' +
    capIds.map((id) => `  '${id}',`).join('\n') +
    '\n] as const;\n\n' +
    'export type CapabilityId = (typeof CAPABILITY_IDS)[number];\n\n' +
    'export interface CapabilityRisk {\n' +
    '  readonly effect: string;\n' +
    '  readonly scope: string;\n' +
    '  readonly reversibility: string;\n' +
    '  readonly approval: string;\n' +
    '  readonly level: string;\n' +
    '}\n\n' +
    'export interface CapabilityMeta {\n' +
    '  readonly id: CapabilityId;\n' +
    '  readonly milestone: string;\n' +
    '  readonly status: string;\n' +
    '  readonly summary: string;\n' +
    '  readonly risk: CapabilityRisk;\n' +
    '  readonly developerTool: string | null;\n' +
    '  readonly debugTool: string | null;\n' +
    '  readonly authoringTool: string | null;\n' +
    '  readonly bridgeOperation: string | null;\n' +
    '  readonly dslStep: string | null;\n' +
    '  readonly errors: readonly string[];\n' +
    '}\n\n' +
    'export const CAPABILITIES: Readonly<Record<CapabilityId, CapabilityMeta>> = {\n' +
    caps
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(
        (c) =>
          `  '${c.id}': {\n` +
          `    id: '${c.id}',\n` +
          `    milestone: '${c.milestone}',\n` +
          `    status: '${c.status ?? 'planned'}',\n` +
          `    summary: ${JSON.stringify(c.summary)},\n` +
          `    risk: { effect: '${c.risk.effect}', scope: '${c.risk.scope}', reversibility: '${c.risk.reversibility}', approval: '${c.risk.approval}', level: '${c.risk.level}' },\n` +
          `    developerTool: ${c.exposure.developer_tool ? `'${c.exposure.developer_tool}'` : 'null'},\n` +
          `    debugTool: ${c.exposure.debug_tool ? `'${c.exposure.debug_tool}'` : 'null'},\n` +
          `    authoringTool: ${c.exposure.authoring_tool ? `'${c.exposure.authoring_tool}'` : 'null'},\n` +
          `    bridgeOperation: ${c.exposure.bridge_operation ? `'${c.exposure.bridge_operation}'` : 'null'},\n` +
          `    dslStep: ${c.exposure.dsl_step ? `'${c.exposure.dsl_step}'` : 'null'},\n` +
          `    errors: [${(c.errors ?? []).map((e) => `'${e}'`).join(', ')}],\n` +
          `  },`,
      )
      .join('\n') +
    '\n} as const;\n\n' +
    '/** Tool adı -> capability id. Aynı tool adı iki capability\'de kullanılamaz\n' +
    ' *  (scripts/validate-registry.mjs kuralı 8), bu yüzden eşleme tekil. */\n' +
    'export const TOOL_TO_CAPABILITY: Readonly<Record<string, CapabilityId>> = {\n' +
    (() => {
      const pairs = [];
      for (const c of caps) {
        for (const t of [c.exposure.developer_tool, c.exposure.debug_tool, c.exposure.authoring_tool]) {
          if (t) pairs.push([t, c.id]);
        }
      }
      const unique = new Map(pairs);
      return [...unique.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tool, id]) => `  '${tool}': '${id}',`)
        .join('\n');
    })() +
    '\n} as const;\n',
);

const errCodes = errs.map((e) => e.code).sort();
emit(
  join(PATHS.generated, 'errors.generated.ts'),
  HEADER +
    '\nexport const ERROR_CODES = [\n' +
    errCodes.map((c) => `  '${c}',`).join('\n') +
    '\n] as const;\n\n' +
    'export type ErrorCode = (typeof ERROR_CODES)[number];\n\n' +
    'export interface ErrorMeta {\n' +
    '  readonly code: ErrorCode;\n' +
    '  readonly owner: string;\n' +
    '  readonly category: string;\n' +
    '  readonly message: string;\n' +
    '  readonly retryable: boolean;\n' +
    '  readonly suggestedAction: string;\n' +
    '  readonly protocolError: boolean;\n' +
    '  readonly httpStatus: number | null;\n' +
    '  readonly redactionProfile: string;\n' +
    '  readonly terminalState: string | null;\n' +
    '}\n\n' +
    'export const ERRORS: Readonly<Record<ErrorCode, ErrorMeta>> = {\n' +
    errs
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(
        (e) =>
          `  ${e.code}: {\n` +
          `    code: '${e.code}',\n` +
          `    owner: '${e.owner}',\n` +
          `    category: '${e.category}',\n` +
          `    message: ${JSON.stringify(e.message)},\n` +
          `    retryable: ${e.tool_result.retryable},\n` +
          `    suggestedAction: ${JSON.stringify(e.tool_result.suggested_action)},\n` +
          `    protocolError: ${e.json_rpc_mapping.protocol_error},\n` +
          `    httpStatus: ${e.bridge_mapping?.http_status ?? 'null'},\n` +
          `    redactionProfile: '${e.redaction.profile}',\n` +
          `    terminalState: ${e.terminal_state ? `'${e.terminal_state}'` : 'null'},\n` +
          `  },`,
      )
      .join('\n') +
    '\n} as const;\n',
);

emit(
  join(PATHS.generated, 'tool-profiles.generated.ts'),
  HEADER +
    '\n// Sıra normatiftir (docs/contracts/mcp.md TL-04): aynı profilde tool sırası\n' +
    '// deterministik olmalıdır.\n' +
    'export const TOOL_PROFILES = {\n' +
    Object.entries(profiles.profiles)
      .map(
        ([name, p]) =>
          `  '${name}': [\n` + p.tools.map((t) => `    '${t}',`).join('\n') + '\n  ],',
      )
      .join('\n') +
    '\n} as const;\n\n' +
    'export type ToolProfileName = keyof typeof TOOL_PROFILES;\n\n' +
    `export const DEFAULT_TOOL_PROFILE: ToolProfileName = '${
      Object.entries(profiles.profiles).find(([, p]) => p.default)?.[0] ?? 'developer'
    }';\n`,
);

// ---------------------------------------------------------------------- Java

const bridgeOps = caps
  .map((c) => c.exposure.bridge_operation)
  .filter(Boolean)
  .sort();

const javaConst = (s) => s.replace(/[.]/g, '_').replace(/[a-z]/g, (m) => m.toUpperCase());

emit(
  join(JAVA_DIR, 'BridgeOperation.java'),
  `// Bu dosya \`pnpm run gen\` tarafından üretilir. ELLE DÜZENLEMEYİN.\npackage ${JAVA_PKG};\n\n` +
    'public enum BridgeOperation {\n' +
    bridgeOps.map((op) => `    ${javaConst(op)}("${op}")`).join(',\n') +
    ';\n\n' +
    '    private final String wireName;\n\n' +
    '    BridgeOperation(String wireName) {\n' +
    '        this.wireName = wireName;\n' +
    '    }\n\n' +
    '    public String wireName() {\n' +
    '        return wireName;\n' +
    '    }\n\n' +
    '    public static BridgeOperation fromWireName(String value) {\n' +
    '        for (BridgeOperation op : values()) {\n' +
    '            if (op.wireName.equals(value)) {\n' +
    '                return op;\n' +
    '            }\n' +
    '        }\n' +
    '        throw new IllegalArgumentException("Unknown bridge operation: " + value);\n' +
    '    }\n' +
    '}\n',
);

emit(
  join(JAVA_DIR, 'ErrorCode.java'),
  `// Bu dosya \`pnpm run gen\` tarafından üretilir. ELLE DÜZENLEMEYİN.\npackage ${JAVA_PKG};\n\n` +
    'public enum ErrorCode {\n' +
    errs
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((e) => `    ${e.code}(${e.bridge_mapping?.http_status ?? 500}, ${e.tool_result.retryable})`)
      .join(',\n') +
    ';\n\n' +
    '    private final int httpStatus;\n' +
    '    private final boolean retryable;\n\n' +
    '    ErrorCode(int httpStatus, boolean retryable) {\n' +
    '        this.httpStatus = httpStatus;\n' +
    '        this.retryable = retryable;\n' +
    '    }\n\n' +
    '    public int httpStatus() {\n' +
    '        return httpStatus;\n' +
    '    }\n\n' +
    '    public boolean retryable() {\n' +
    '        return retryable;\n' +
    '    }\n' +
    '}\n',
);

// -------------------------------------------------------------- Docs + şema

const riskRows = caps
  .slice()
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(
    (c) =>
      `| \`${c.id}\` | ${c.milestone} | ${c.risk.effect} | ${c.risk.scope} | ${c.risk.reversibility} | ${c.risk.approval} | **${c.risk.level}** | ${
        c.exposure.developer_tool ? `\`${c.exposure.developer_tool}\`` : '—'
      } | ${c.exposure.debug_tool ? `\`${c.exposure.debug_tool}\`` : '—'} |`,
  )
  .join('\n');

{
  const file = join(PATHS.docs, 'contracts', 'capability-registry.md');
  const current = readFileSync(file, 'utf8');
  const begin = '<!-- BEGIN GENERATED: risk-matrix -->';
  const end = '<!-- END GENERATED: risk-matrix -->';
  const head =
    '| Capability | Milestone | Effect | Scope | Reversibility | Approval | Level | Developer tool | Debug tool |\n' +
    '|---|---|---|---|---|---|---|---|---|';
  const s = current.indexOf(begin);
  const e = current.indexOf(end);
  if (s === -1 || e === -1) fail([`risk-matrix generated bloğu bulunamadı: ${file}`]);
  emit(file, current.slice(0, s + begin.length) + '\n' + head + '\n' + riskRows + '\n' + current.slice(e));
}

{
  // Scenario DSL step allowlist'i registry'den türetilir.
  const steps = [...new Set(caps.map((c) => c.exposure.dsl_step).filter(Boolean))].sort();
  const file = join(PATHS.contracts, 'scenario', 'scenario.schema.json');
  const schema = JSON.parse(readFileSync(file, 'utf8'));
  schema.$defs.stepName.enum = steps;
  emit(file, JSON.stringify(schema, null, 2) + '\n');
}

// ----------------------------------------------------------------- Yazma

const drift = [];
for (const { file, content } of pending) {
  const exists = existsSync(file);
  const same = exists && readFileSync(file, 'utf8') === content;

  if (CHECK) {
    if (!same) drift.push(exists ? `Drift: ${file}` : `Eksik generated dosya: ${file}`);
    continue;
  }
  if (!same) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
  }
}

if (CHECK) {
  if (drift.length) {
    fail([...drift, 'Düzeltmek için: pnpm run gen']);
  }
  ok(`${pending.length} generated dosya güncel.`);
} else {
  ok(`${pending.length} dosya üretildi.`);
}
