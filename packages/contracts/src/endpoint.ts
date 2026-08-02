/**
 * Supervisor kontrol dosyası — MCP Server ile Run Supervisor'ın buluşma noktası.
 *
 * Konum ve şema paylaşılan sözleşmedir: iki ayrı implementasyon, iki ayrı
 * "dosyayı bulamadım" davranışı demek olurdu.
 *
 * Güvenlik sınırı **dosya sistemi izinleridir**: dizin 0700, dosya 0600 ile
 * oluşturulur ve kullanıcıya özeldir. Token ek katmandır — aynı makinedeki
 * başka bir kuruluma kazara bağlanmayı önler.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, userInfo } from 'node:os';

export const CONTROL_FILE_NAME = 'supervisor-endpoint.json';

export interface SupervisorEndpoint {
  /** Named pipe adı (Windows) veya unix socket yolu (POSIX). */
  readonly path: string;
  readonly token: string;
  readonly pid: number;
  readonly startedAt: string;
}

function safeUser(): string {
  try {
    return userInfo().username.replace(/[^A-Za-z0-9_-]/g, '_');
  } catch {
    return 'unknown';
  }
}

/** Kontrol dosyasının yaşadığı dizin. Kullanıcıya özeldir. */
export function controlDir(): string {
  const override = process.env['MCPDEV_CONTROL_DIR'];
  if (override && override.trim() !== '') {
    return override;
  }
  return join(tmpdir(), `mcpdev-${safeUser()}`);
}

export function controlFilePath(): string {
  return join(controlDir(), CONTROL_FILE_NAME);
}

export function controlUserSlug(): string {
  return safeUser();
}

/**
 * Kontrol dosyasını okur.
 *
 * Bozuk veya eksik dosya `null` döndürür; kısmen okunmuş bir endpoint ile
 * bağlanmayı denemek, teşhisi zor bir zaman aşımına yol açardı.
 */
export async function readControlFile(): Promise<SupervisorEndpoint | null> {
  const file = controlFilePath();
  if (!existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as SupervisorEndpoint;
    if (
      typeof parsed.path !== 'string' ||
      parsed.path === '' ||
      typeof parsed.token !== 'string' ||
      parsed.token.length < 32
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
