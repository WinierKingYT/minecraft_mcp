/**
 * Structured log — docs/operations/observability.md.
 *
 *   stdout    -> yalnızca JSON-RPC (StdoutGuard tarafından korunur)
 *   stderr    -> operational log  <-- BU DOSYA
 *   file sink -> structured JSON log (M0'da eklenecek)
 */

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

const LEVEL_ORDER: Record<LogLevel, number> = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };

let threshold: LogLevel = 'INFO';

export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

/**
 * telemetry.redact_patterns karşılığı. M0'da config'ten okunacak; bootstrap
 * aşamasında güvenli tarafta sabit tutulur (CF-06: güvensiz default yok).
 */
const REDACT_KEYS = /token|secret|password|authorization|credential|cookie/i;

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = REDACT_KEYS.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] > LEVEL_ORDER[threshold]) return;

  process.stderr.write(
    JSON.stringify({
      level,
      component: 'mcp-server',
      event,
      ...redact(fields),
    }) + '\n',
  );
}
