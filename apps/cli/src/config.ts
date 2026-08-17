/**
 * mcpdev config — MCP client auto-configuration (Phase 2).
 *
 * `mcpdev config <client>` ile desteklenen istemcilere `mcpdev serve` stdio
 * tanımı yazar/doğrular (P0-7 launcher yüzeyi):
 *
 *   claude   Claude Desktop   → mcpServers.mcpdev   { command, args: [.., 'serve'] }
 *   vscode   VSCode (workspace) → servers.mcpdev    { type: 'stdio', command, args: [.., 'serve'] }
 *   cursor   Cursor (global)   → mcpServers.mcpdev   { command, args: [.., 'serve'] }
 *   opencode opencode (global) → mcp.mcpdev          { type: 'local', command: [node, .., 'serve'], enabled: true }
 *
 * Komut mutlak `node` + derlenmiş CLI giriş noktasıdır (PATH'e bağımlılık
 * yoktur; standalone ve workspace düzenlerinde çalışır). Mevcut bir tanım
 * farklıysa varsayılan olarak değiştirilmez — `--force` gerekir; aynıysa
 * 'already configured' raporlanır. Yeni dosyalar atomic (tmp+rename) yazılır.
 */

import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import type { McpdevLayout } from './layout.js';
import { detectLayout } from './layout.js';

export type McpClientId = 'claude' | 'vscode' | 'cursor' | 'opencode';

export interface ConfigOptions {
  readonly client: McpClientId;
  readonly json?: boolean;
  readonly force?: boolean;
  /** VSCode workspace kökü (default: cwd). */
  readonly workspaceRoot?: string;
  /** Test/ortam override'ı. */
  readonly homeDir?: string;
  readonly layout?: McpdevLayout;
}

export interface ConfigReport {
  readonly client: McpClientId;
  readonly filePath: string;
  readonly action: 'created' | 'updated' | 'identical' | 'conflict' | 'failed';
  readonly message: string;
  readonly serverName: string;
}

export const MCP_SERVER_NAME = 'mcpdev';

/** Derlenmiş CLI giriş noktası (layout-aware). */
export function cliEntry(layout: McpdevLayout): string {
  return layout.kind === 'standalone'
    ? join(layout.root, 'dist', 'cli', 'src', 'index.js')
    : join(layout.root, 'apps', 'cli', 'dist', 'src', 'index.js');
}

export function clientConfigPath(client: McpClientId, options: {
  homeDir?: string;
  workspaceRoot?: string;
  cwd?: string;
}): string {
  const hasHomeOverride = options.homeDir !== undefined;
  const home = options.homeDir ?? homedir();
  switch (client) {
    case 'claude':
      // Win32'de gerçek kullanıcıdaki Claude Desktop %APPDATA% altındadır;
      // ancak homeDir override (test/ortam) verildiyse APPDATA kullanılmaz.
      if (process.platform === 'win32') {
        return hasHomeOverride
          ? join(home, 'Claude', 'claude_desktop_config.json')
          : join(process.env['APPDATA'] ?? home, 'Claude', 'claude_desktop_config.json');
      }
      if (process.platform === 'darwin') {
        return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      }
      return join(home, '.config', 'Claude', 'claude_desktop_config.json');
    case 'vscode':
      return join(options.workspaceRoot ?? options.cwd ?? process.cwd(), '.vscode', 'mcp.json');
    case 'cursor':
      return join(home, '.cursor', 'mcp.json');
    case 'opencode':
      return join(home, '.config', 'opencode', 'opencode.json');
  }
}

/** İstemciye özgü MCP tanımı üretir (node + mutlak giriş noktası). */
export function buildServerEntry(client: McpClientId, layout: McpdevLayout): Record<string, unknown> {
  const command = process.execPath;
  const args = [cliEntry(layout), 'serve'];
  switch (client) {
    case 'claude':
    case 'cursor':
      return { command, args };
    case 'vscode':
      return { type: 'stdio', command, args };
    case 'opencode':
      return { type: 'local', command: [command, ...args], enabled: true };
  }
}

/** Config kök anahtarı: claude/cursor mcpServers, vscode servers, opencode mcp. */
export function containerKey(client: McpClientId): string {
  switch (client) {
    case 'vscode':
      return 'servers';
    case 'opencode':
      return 'mcp';
    case 'claude':
    case 'cursor':
      return 'mcpServers';
  }
}

function readJsonIfExists(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    return {} as Record<string, unknown>;
  } catch {
    // Geçersiz JSON: asla üzerine yazma — kullanıcıya rapor et.
    return null;
  }
}

function entriesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function runConfig(options: ConfigOptions): Promise<number> {
  const layout = options.layout ?? detectLayout();
  const filePath = clientConfigPath(options.client, {
    ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
    ...(options.workspaceRoot !== undefined ? { workspaceRoot: options.workspaceRoot } : {}),
  });
  const container = containerKey(options.client);
  const entry = buildServerEntry(options.client, layout);

  const existing = readJsonIfExists(filePath);
  if (existing === null && existsSync(filePath)) {
    throw new Error(`Mevcut config JSON ayrıştırılamıyor — elle düzeltin: ${filePath}`);
  }

  const current =
    existing !== null && typeof existing[container] === 'object' && existing[container] !== null
      ? ((existing[container] as Record<string, unknown>)[MCP_SERVER_NAME] ?? null)
      : null;

  let action: 'created' | 'updated' | 'identical' | 'conflict';
  let message: string;
  if (current !== null && !entriesEqual(current, entry)) {
    if (!options.force) {
      const report: ConfigReport = {
        client: options.client,
        filePath,
        action: 'conflict',
        message: `Mevcut '${MCP_SERVER_NAME}' tanımı farklı — üzerine yazmak için --force kullanın`,
        serverName: MCP_SERVER_NAME,
      };
      printReport(report, options.json ?? false);
      return 1;
    }
    action = 'updated';
    message = `Mevcut '${MCP_SERVER_NAME}' tanımı güncellendi`;
  } else if (current !== null && entriesEqual(current, entry)) {
    const report: ConfigReport = {
      client: options.client,
      filePath,
      action: 'identical',
      message: `'${MCP_SERVER_NAME}' zaten yapılandırılmış`,
      serverName: MCP_SERVER_NAME,
    };
    printReport(report, options.json ?? false);
    return 0;
  } else {
    action = 'created';
    message = `'${MCP_SERVER_NAME}' server tanımı yazıldı`;
  }

  const root = existing ?? {};
  const containerObj =
    (root[container] as Record<string, unknown> | undefined) ?? {};
  containerObj[MCP_SERVER_NAME] = entry;
  root[container] = containerObj;

  const tmp = `${filePath}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(root, null, 2)}\n`, 'utf8');
  await rename(tmp, filePath);

  const report: ConfigReport = {
    client: options.client,
    filePath,
    action,
    message,
    serverName: MCP_SERVER_NAME,
  };
  printReport(report, options.json ?? false);
  return 0;
}

function printReport(report: ConfigReport, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const icon = report.action === 'conflict' || report.action === 'failed' ? '\x1b[31m✖\x1b[0m' : '\x1b[32m✔\x1b[0m';
  process.stdout.write(`${icon} mcpdev config ${report.client}: ${report.message}\n`);
  process.stdout.write(`  File: ${report.filePath}\n`);
  if (report.action === 'conflict') {
    process.stdout.write('  Tip: mevcut tanımı korumak istiyorsanız dosyayı elle düzenleyin;\n');
    process.stdout.write('       mcpdev tanımını güncellemek için --force kullanın.\n');
  }
}