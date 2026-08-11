/**
 * stdout purity guard — docs/contracts/mcp.md, ADR-0002.
 *
 * INVARIANT: MCP Server stdout'undaki her byte JSON-RPC transport parser'ından
 * geçebilmelidir.
 *
 * ADR-0008 (official SDK) sonrası purity iki katmanla korunur:
 *   1. SDK'nın StdioServerTransport'u stdout'a yalnızca protokol mesajlarını
 *      yazar; kendi yazım hattı `process.stdout` yerine verilen writer üzerinden
 *      çalışır ve dışarıya başka bir byte sızdırmaz.
 *   2. Bu guard `console.*` yollarının tamamını stderr'e yönlendirir: import
 *      zamanında veya handler içinde oluşan kaçak bir log protokole karışamaz.
 *
 * Guard'ın eski sürümü `process.stdout.write`'ı sarmalıyordu; SDK'nın transport
 * yazımları o sarmalayıcıya takılıp engellenirdi, bu yüzden yalnızca console
 * yönlendirmesi kaldı (CT-MCP-STDOUT-001 doğrulaması conformance testindedir).
 */

let installed = false;

export function installStdoutGuard(): void {
  if (installed) return;
  installed = true;

  // console.* -> stderr. Kütüphanelerin kaçak logları da buraya düşer.
  const toStderr =
    (level: string) =>
    (...args: unknown[]): void => {
      process.stderr.write(
        JSON.stringify({
          level,
          component: 'console',
          event: 'console.redirected',
          message: args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' '),
        }) + '\n',
      );
    };

  console.log = toStderr('INFO');
  console.info = toStderr('INFO');
  console.warn = toStderr('WARN');
  console.error = toStderr('ERROR');
  console.debug = toStderr('DEBUG');
  console.trace = toStderr('DEBUG');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '<unserializable>';
  }
}
