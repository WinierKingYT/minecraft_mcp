/**
 * Ortak test oturum yardımcısı — official SDK client üzerinden MCP Server'a
 * bağlanır (ADR-0008, SPIKE-MCP-SDK-2026-001).
 *
 * Client, 2026-07-28 modern era'ya pinlenir (versionNegotiation) — conformance
 * testleri protokolün stateless yüzeyini doğrular. Legacy (2025-11-25)
 * davranışı ayrı bir test ile kapsanır.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = dirname(fileURLToPath(import.meta.url));
// dist/test/helpers -> dist/src/index.js
export const serverEntry = join(here, '..', '..', 'src', 'index.js');
// dist/test/helpers -> repo kökü (apps/mcp-server/dist/test/helpers: 5 seviye)
export const repoRoot = resolve(here, '..', '..', '..', '..', '..');

export interface SessionOptions {
  readonly profile?: string;
  readonly env?: Record<string, string>;
  /** Client'ı legacy (2025-11-25) negotiation'da başlatır. */
  readonly legacy?: boolean;
}

export interface Session {
  readonly client: Client;
  readonly transport: StdioClientTransport;
  readonly child: ChildProcessWithoutNullStreams;
  readonly close: () => Promise<void>;
}

/**
 * Server'ı spawn eder, official client ile bağlanır ve oturumu döndürür.
 * Kapanışta transport kapatılır, child'ın çıkması beklenir.
 */
export async function startSession(options: SessionOptions = {}): Promise<Session> {
  const child = spawn(process.execPath, [serverEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MCPDEV_ROOT: repoRoot,
      ...(options.profile ? { MCPDEV_TOOL_PROFILE: options.profile } : {}),
      ...(options.env ?? {}),
    },
  });
  child.stderr.resume();
  // Pipe buffer'ının dolup server yazımlarını bloke etmemesi için stdout tüketilir.
  child.stdout.resume();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      ...process.env,
      MCPDEV_ROOT: repoRoot,
      ...(options.profile ? { MCPDEV_TOOL_PROFILE: options.profile } : {}),
      ...(options.env ?? {}),
    },
  });

  const client = new Client(
    { name: 'contract-test', version: '0.0.0' },
    options.legacy ? {} : { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await client.connect(transport);

  return {
    client,
    transport,
    child,
    close: async () => {
      await client.close();
      // Bağımsız spawn edilen ikinci örnek: stdin EOF ile kapanır.
      child.stdin.end();
      await new Promise<void>((res) => child.on('close', () => res()));
    },
  };
}
