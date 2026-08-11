/**
 * Test fixture — sahte Supervisor.
 *
 * Gerçek supervisor başlatmak ağır olduğundan (compatibility profile + IPC
 * server), serve launcher'ın spawn/lifecycle davranışı bu sahte süreçle test
 * edilir. Kontrol dosyasını kendi pid'iyle yazar (readControlFile şemasına
 * uygun), argümanlarını ve pid'ini bir çıktı dizinine kaydeder.
 *
 * Ortam:
 *   FAKE_OUT_DIR          — argüman/pid kayıt dizini
 *   FAKE_SUPERVISOR_MODE  — 'silent': kontrol dosyası yazmaz (timeout testi)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.env['FAKE_OUT_DIR'] ?? process.cwd();
const mode = process.env['FAKE_SUPERVISOR_MODE'] ?? 'normal';

writeFileSync(join(outDir, 'supervisor-args.txt'), process.argv.slice(2).join(' '), 'utf8');
writeFileSync(join(outDir, 'supervisor-pid.txt'), String(process.pid), 'utf8');

if (mode !== 'silent') {
  const controlDir = process.env['MCPDEV_CONTROL_DIR'];
  if (controlDir) {
    mkdirSync(controlDir, { recursive: true });
    writeFileSync(
      join(controlDir, 'supervisor-endpoint.json'),
      JSON.stringify({
        path: `\\\\.\\pipe\\fake-supervisor-${process.pid}`,
        token: `fake-token-${'x'.repeat(32)}`,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
      'utf8',
    );
  }
}

// Süreci canlı tut; exit yalnızca dışarıdan sinyal/kill ile gelir.
setInterval(() => {}, 1000);
