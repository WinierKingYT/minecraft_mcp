/**
 * Supervisor tarafındaki kontrol dosyası yazımı.
 *
 * Konum ve şema `@mcpdev/contracts` içindedir; burada yalnızca YAZMA ve IPC
 * yolu üretimi bulunur — okuma tarafı MCP Server'da aynı sözleşmeyi kullanır.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { controlDir, controlFilePath, controlUserSlug, type SupervisorEndpoint } from '@mcpdev/contracts';

export { controlDir, controlFilePath, type SupervisorEndpoint };

/** Platforma uygun IPC yolu üretir. */
export function makeEndpointPath(): string {
  if (process.platform === 'win32') {
    // Named pipe: dosya sisteminde yer kaplamaz, oturum kapsamındadır.
    return `\\\\.\\pipe\\mcpdev-supervisor-${controlUserSlug()}-${randomBytes(8).toString('hex')}`;
  }
  return join(controlDir(), `supervisor-${randomBytes(8).toString('hex')}.sock`);
}

export async function writeControlFile(endpoint: SupervisorEndpoint): Promise<string> {
  await mkdir(controlDir(), { recursive: true, mode: 0o700 });
  const file = controlFilePath();
  await writeFile(file, JSON.stringify(endpoint, null, 2), { mode: 0o600 });
  return file;
}

export async function removeControlFile(): Promise<void> {
  await rm(controlFilePath(), { force: true });
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}
