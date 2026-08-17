/**
 * `ProjectValidateResult.distributionSha256Valid` semantiği (aggregation).
 *
 * "Checksum mevcut" ≠ "geçerli" (service.ts eski davranışı: varlığı geçerli
 * diye etiketliyordu). Alan yalnızca checksum varsa VE validator eşleşme
 * hatası üretmemişse true olur. Eksik checksum (MISSING bulgusu) doğal olarak
 * false üretir çünkü alan o zaman null'dur.
 */

export interface HasCode {
  readonly code: string;
}

export function distributionChecksumValid(
  distributionSha256: string | null,
  findings: readonly HasCode[],
  invalidCode: string,
): boolean {
  return distributionSha256 !== null && !findings.some((f) => f.code === invalidCode);
}