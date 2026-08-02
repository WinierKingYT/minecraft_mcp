/**
 * Sınırlı ZIP/JAR okuyucu.
 *
 * Bağımlılık eklemek yerine kendimiz yazıyoruz. Gerekçe: yalnızca birkaç
 * girdiyi okumamız gerekiyor ve daha önemlisi, docs/security/controls.md
 * FS-11/FS-12'de belgelediğimiz sınırları (traversal, zip bomb) gerçekten
 * UYGULAYABİLMEMİZ için ayrıştırma bizim kontrolümüzde olmalı.
 *
 * Yalnızca central directory üzerinden okuma yapılır; arşiv diske AÇILMAZ.
 */

import { inflateRawSync } from 'node:zlib';

export class ArchiveError extends Error {
  constructor(
    readonly code:
      | 'ARCHIVE_INVALID'
      | 'ARCHIVE_ENTRY_OUTSIDE_ROOT'
      | 'ARCHIVE_EXPANSION_LIMIT'
      | 'ARCHIVE_ENTRY_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export interface ZipLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
  /** Tek girdi için izin verilen en yüksek sıkıştırma oranı. */
  readonly maxCompressionRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 20_000,
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  // 1000:1 üzeri oran pratikte zip bomb işaretidir; normal JAR'lar 5:1 civarı.
  maxCompressionRatio: 1000,
};

export interface ZipEntry {
  readonly name: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly isDirectory: boolean;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;

/**
 * Girdi adının arşiv kökünün dışına çıkmadığını doğrular.
 *
 * Biz arşivi diske açmasak da bu kontrol yapılır: adı `../` içeren bir girdi,
 * çağıranın onu bir yola çevirmesi hâlinde traversal'a dönüşür. Kontrolü
 * okuma katmanında yapmak, her çağıranın hatırlamasına bağlı olmaktan iyidir.
 */
export function assertSafeEntryName(name: string): void {
  if (name.includes('\0')) {
    throw new ArchiveError('ARCHIVE_INVALID', 'Girdi adı null bayt içeriyor.');
  }
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name)) {
    throw new ArchiveError('ARCHIVE_ENTRY_OUTSIDE_ROOT', `Mutlak yol içeren arşiv girdisi: ${name}`);
  }
  for (const segment of name.split(/[/\\]/)) {
    if (segment === '..') {
      throw new ArchiveError('ARCHIVE_ENTRY_OUTSIDE_ROOT', `Traversal içeren arşiv girdisi: ${name}`);
    }
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - (EOCD_MIN_SIZE + MAX_COMMENT_SIZE));
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= start; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      return i;
    }
  }
  throw new ArchiveError('ARCHIVE_INVALID', 'ZIP end-of-central-directory kaydı bulunamadı.');
}

/** Central directory'yi okur; içerik açılmaz. */
export function readZipEntries(buffer: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);

  if (entryCount > limits.maxEntries) {
    throw new ArchiveError(
      'ARCHIVE_EXPANSION_LIMIT',
      `Arşiv girdi sayısı limiti aştı: ${entryCount} > ${limits.maxEntries}`,
    );
  }
  if (directoryOffset >= buffer.length) {
    throw new ArchiveError('ARCHIVE_INVALID', 'Central directory offset arşiv dışında.');
  }

  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new ArchiveError('ARCHIVE_INVALID', `Bozuk central directory girdisi (#${i}).`);
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    assertSafeEntryName(name);

    if (uncompressedSize > limits.maxEntryBytes) {
      throw new ArchiveError(
        'ARCHIVE_EXPANSION_LIMIT',
        `Arşiv girdisi boyut limitini aştı: ${name} (${uncompressedSize} bayt)`,
      );
    }
    // Zip bomb: küçük sıkıştırılmış veriden devasa çıktı.
    if (compressedSize > 0 && uncompressedSize / compressedSize > limits.maxCompressionRatio) {
      throw new ArchiveError(
        'ARCHIVE_EXPANSION_LIMIT',
        `Aşırı sıkıştırma oranı: ${name} (${Math.round(uncompressedSize / compressedSize)}:1)`,
      );
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalBytes) {
      throw new ArchiveError(
        'ARCHIVE_EXPANSION_LIMIT',
        `Arşiv toplam açılım boyutu limitini aştı (${limits.maxTotalBytes} bayt).`,
      );
    }

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Tek bir girdinin içeriğini açar. Yalnızca STORE ve DEFLATE desteklenir. */
export function readZipEntry(buffer: Buffer, entry: ZipEntry, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Buffer {
  const header = entry.localHeaderOffset;
  if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== LOCAL_SIGNATURE) {
    throw new ArchiveError('ARCHIVE_INVALID', `Bozuk local header: ${entry.name}`);
  }

  const nameLength = buffer.readUInt16LE(header + 26);
  const extraLength = buffer.readUInt16LE(header + 28);
  const dataStart = header + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;

  if (dataEnd > buffer.length) {
    throw new ArchiveError('ARCHIVE_INVALID', `Girdi verisi arşiv dışına taşıyor: ${entry.name}`);
  }

  const compressed = buffer.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    return Buffer.from(compressed);
  }
  if (entry.compressionMethod !== 8) {
    throw new ArchiveError(
      'ARCHIVE_INVALID',
      `Desteklenmeyen sıkıştırma yöntemi (${entry.compressionMethod}): ${entry.name}`,
    );
  }

  // maxOutputLength: inflate sırasında da sınır uygulanır; bildirilen
  // uncompressedSize'a güvenmek yetmez, çünkü o alan yalan söyleyebilir.
  const inflated = inflateRawSync(compressed, { maxOutputLength: limits.maxEntryBytes });
  return Buffer.from(inflated);
}

/** Adı verilen girdiyi okur; yoksa null. */
export function readZipEntryByName(
  buffer: Buffer,
  name: string,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): Buffer | null {
  const entries = readZipEntries(buffer, limits);
  const entry = entries.find((e) => e.name === name && !e.isDirectory);
  return entry ? readZipEntry(buffer, entry, limits) : null;
}

/** Belirtilen sınıf adının JAR içinde bulunup bulunmadığını söyler. */
export function jarContainsClass(entries: readonly ZipEntry[], className: string): boolean {
  const path = `${className.replace(/\./g, '/')}.class`;
  return entries.some((e) => e.name === path);
}
