/**
 * stdout purity guard — docs/contracts/mcp.md, ADR-0002.
 *
 * INVARIANT: MCP Server stdout'undaki her byte JSON-RPC transport parser'ından
 * geçebilmelidir.
 *
 * Bu bir konvansiyon değil, test edilen bir kuraldır (CT-MCP-STDOUT-001). Tek
 * bir kaçak `console.log`, istemcinin bağlantısını sessizce bozar ve teşhisi
 * zor bir hata üretir.
 *
 * Guard iki katman uygular:
 *   1. Tüm console.* yolları stderr'e yönlendirilir.
 *   2. process.stdout.write yalnızca "sealed writer" üzerinden yazmaya izin
 *      verir; başka bir çağrı yakalanır, stderr'e ihlal kaydı düşülür ve
 *      stdout'a HİÇBİR ŞEY yazılmaz.
 */

const STDOUT_TOKEN = Symbol('mcp.stdout.authorized');

type WriteArgs = Parameters<typeof process.stdout.write>;

export interface StdoutGuard {
  /** Protokol mesajı yazmanın TEK izinli yolu. */
  writeProtocolMessage(payload: string): void;
  /** Guard kurulduktan sonra yakalanan ihlal sayısı (test için). */
  violationCount(): number;
}

let installed: StdoutGuard | null = null;

export function installStdoutGuard(): StdoutGuard {
  if (installed) return installed;

  const rawWrite = process.stdout.write.bind(process.stdout);
  let violations = 0;

  const guardedWrite = function guardedWrite(this: unknown, ...args: WriteArgs): boolean {
    const marker = (guardedWrite as unknown as Record<symbol, unknown>)[STDOUT_TOKEN];
    if (marker === true) {
      return rawWrite(...args);
    }

    violations += 1;
    const chunk = typeof args[0] === 'string' ? args[0] : '<binary>';
    process.stderr.write(
      JSON.stringify({
        level: 'ERROR',
        component: 'mcp-server',
        event: 'stdout.purity.violation',
        detail: 'stdout write outside the protocol writer was blocked',
        preview: chunk.slice(0, 200),
      }) + '\n',
    );

    // Callback sözleşmesini koru: yazmadık, ama çağıranı askıda bırakma.
    const cb = args.find((a) => typeof a === 'function') as ((e?: Error | null) => void) | undefined;
    cb?.(null);
    return true;
  };

  process.stdout.write = guardedWrite as typeof process.stdout.write;

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

  installed = {
    writeProtocolMessage(payload: string): void {
      const w = process.stdout.write as unknown as Record<symbol, unknown>;
      w[STDOUT_TOKEN] = true;
      try {
        rawWrite(payload);
      } finally {
        w[STDOUT_TOKEN] = false;
      }
    },
    violationCount: () => violations,
  };

  return installed;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '<unserializable>';
  }
}
