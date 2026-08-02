/**
 * Satır sonlandırmalı JSON çerçeveleme.
 *
 * Hem MCP Server hem Run Supervisor tarafından kullanılır; iki ayrı
 * implementasyon, iki ayrı sınır davranışı demek olurdu.
 *
 * Sert boyut sınırı zorunludur: sınırsız bir tampon, tek bir bozuk veya kötü
 * niyetli yazıcının karşı tarafın belleğini tüketmesine izin verirdi.
 */

export class FrameTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`IPC çerçevesi ${limitBytes} bayt sınırını aştı.`);
    this.name = 'FrameTooLargeError';
  }
}

/**
 * Akıştan gelen parçaları satırlara böler.
 *
 * Kullanım: `push(chunk)` her çağrıda tamamlanmış satırları döndürür; yarım
 * satır bir sonraki çağrıya taşınır.
 */
export class NdjsonDecoder {
  #buffer = '';
  readonly #limit: number;

  constructor(limitBytes: number) {
    this.#limit = limitBytes;
  }

  push(chunk: string): string[] {
    this.#buffer += chunk;

    // Sınır kontrolü satır tamamlanmadan ÖNCE yapılır: aksi hâlde sonsuz bir
    // satır göndererek sınırı tamamen atlatmak mümkün olurdu.
    if (this.#buffer.length > this.#limit) {
      this.#buffer = '';
      throw new FrameTooLargeError(this.#limit);
    }

    const lines: string[] = [];
    let index = this.#buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (line !== '') {
        lines.push(line);
      }
      index = this.#buffer.indexOf('\n');
    }
    return lines;
  }

  /** Tamponda bekleyen bayt sayısı (test ve teşhis için). */
  get pending(): number {
    return this.#buffer.length;
  }

  reset(): void {
    this.#buffer = '';
  }
}

export function encodeFrame(message: unknown, limitBytes: number): string {
  const payload = JSON.stringify(message);
  if (payload.length + 1 > limitBytes) {
    throw new FrameTooLargeError(limitBytes);
  }
  return `${payload}\n`;
}
