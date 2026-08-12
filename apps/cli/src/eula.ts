/**
 * mcpdev eula — Minecraft EULA kabul yönetimi (operator yüzeyi).
 *
 * EULA kabulü agent'tan çıkarılmıştır (separation of authority): agent
 * kendi adına EULA kabul edemez; kabul yalnızca yerel kullanıcı tarafından
 * `mcpdev eula accept` ile yapılır. Kabul, supervisor'ın `--eula-file` ile
 * okuduğu kalıcı bir dosyada saklanır; kabul edilmeden runtime oluşturulamaz
 * (EULA_NOT_ACCEPTED).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

export interface EulaOptions {
  readonly command: 'status' | 'accept';
  readonly profileId?: string;
  readonly dataDir?: string;
}

export interface EulaState {
  readonly accepted: boolean;
  readonly acceptedAt?: string;
  readonly profile?: string;
  readonly acceptedBy?: string;
}

export const EULA_URL = 'https://aka.ms/MinecraftEULA';

/** Default veri dizini: $MCPDEV_DATA_DIR veya ~/.mcpdev (platform-aik). */
export function defaultEulaDataDir(): string {
  return process.env.MCPDEV_DATA_DIR ?? join(homedir(), '.mcpdev');
}

export function eulaFilePath(dataDir: string): string {
  return join(dataDir, 'config', 'eula.json');
}

export function readEulaState(dataDir: string): EulaState {
  const file = eulaFilePath(dataDir);
  if (!existsSync(file)) {
    return { accepted: false };
  }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      accepted?: unknown;
      accepted_at?: string;
      profile?: string;
      accepted_by?: string;
    };
    return {
      accepted: raw.accepted === true,
      ...(typeof raw.accepted_at === 'string' ? { acceptedAt: raw.accepted_at } : {}),
      ...(typeof raw.profile === 'string' ? { profile: raw.profile } : {}),
      ...(typeof raw.accepted_by === 'string' ? { acceptedBy: raw.accepted_by } : {}),
    };
  } catch {
    return { accepted: false };
  }
}

async function writeEulaState(dataDir: string, state: EulaState, profileId?: string): Promise<void> {
  const dir = join(dataDir, 'config');
  await mkdir(dir, { recursive: true });
  const file = eulaFilePath(dataDir);
  const tmp = `${file}.tmp`;
  const payload = {
    accepted: true,
    accepted_at: state.acceptedAt ?? new Date().toISOString(),
    ...(profileId !== undefined ? { profile: profileId } : {}),
    accepted_by: state.acceptedBy ?? 'local-user',
  };
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, file);
}

function printStatus(state: EulaState, dataDir: string): void {
  if (state.accepted) {
    stdout.write(`Minecraft EULA accepted\n`);
    if (state.profile) stdout.write(`Profile: ${state.profile}\n`);
    if (state.acceptedAt) stdout.write(`Accepted at: ${state.acceptedAt}\n`);
    if (state.acceptedBy) stdout.write(`Accepted by: ${state.acceptedBy}\n`);
    stdout.write(`Record: ${eulaFilePath(dataDir)}\n`);
  } else {
    stdout.write(`Minecraft EULA has not been accepted.\n`);
    stdout.write(`Run "mcpdev eula accept" to accept the terms at ${EULA_URL}.\n`);
  }
}

export async function runEula(options: EulaOptions): Promise<number> {
  const dataDir = options.dataDir ?? defaultEulaDataDir();

  if (options.command === 'status') {
    printStatus(readEulaState(dataDir), dataDir);
    return 0;
  }

  const state = readEulaState(dataDir);
  if (state.accepted) {
    stdout.write(`Minecraft EULA is already accepted.\n`);
    printStatus(state, dataDir);
    return 0;
  }

  stdout.write(`Minecraft EULA — ${EULA_URL}\n\n`);
  stdout.write(`Accepting means you agree to Mojang's Minecraft EULA on behalf of the local user.\n`);
  stdout.write(`The product will not run Minecraft servers before this acceptance.\n\n`);
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await new Promise<string>((resolve) => rl.question('Do you accept the Minecraft EULA? [y/N] ', resolve));
  rl.close();

  if (!/^y(es)?$/i.test(answer.trim())) {
    stdout.write('Declined. No changes were made.\n');
    return 1;
  }

  await writeEulaState(dataDir, state, options.profileId);
  stdout.write(`Minecraft EULA accepted and recorded.\n`);
  printStatus(readEulaState(dataDir), dataDir);
  return 0;
}
