/**
 * Process Ownership Manager — ADR-0003, security/controls.md PR-03..PR-08.
 *
 * TEMEL KURAL: PID tek başına yeterli DEĞİLDİR.
 *
 * PID'ler yeniden kullanılır (özellikle Windows'ta). Yalnızca PID'e bakarak
 * öldürme yapmak, aynı PID'i almış tamamen ilgisiz bir kullanıcı process'ini
 * öldürmek demektir. Bu yüzden sahiplik dört alanın birlikte eşleşmesiyle
 * doğrulanır; eşleşmezse PROCESS_OWNERSHIP_MISMATCH döner ve
 * SONLANDIRMA YAPILMAZ.
 */

export interface ProcessFingerprint {
  readonly pid: number;
  /** Canonical executable yolu. */
  readonly executablePath: string;
  /** Process başlangıç zamanı (ms epoch). PID reuse'a karşı asıl koruma. */
  readonly startedAtMs: number;
  /** Runtime kökündeki marker dosyasının içerik hash'i. */
  readonly runtimeMarkerSha256: string;
}

export interface OwnershipRecord extends ProcessFingerprint {
  readonly runtimeId: string;
  readonly serverInstanceId: string;
  readonly kind: 'paper' | 'gradle' | 'actor';
  readonly registeredAtMs: number;
}

export type OwnershipVerdict =
  | { readonly owned: true }
  | { readonly owned: false; readonly reason: string; readonly errorCode: 'PROCESS_OWNERSHIP_MISMATCH' };

/**
 * Kayıtlı sahiplik ile gözlenen process'i karşılaştırır.
 *
 * `observed` null ise process artık yoktur — bu bir uyuşmazlık DEĞİLDİR;
 * çağıran taraf bunu "zaten sonlanmış" olarak ele alır.
 */
export function verifyOwnership(record: OwnershipRecord, observed: ProcessFingerprint | null): OwnershipVerdict {
  if (observed === null) {
    return { owned: true };
  }

  const mismatches: string[] = [];

  if (observed.pid !== record.pid) {
    mismatches.push(`pid ${observed.pid} != ${record.pid}`);
  }
  if (observed.executablePath !== record.executablePath) {
    mismatches.push('executable path farklı');
  }
  if (observed.startedAtMs !== record.startedAtMs) {
    mismatches.push('process başlangıç zamanı farklı (PID reuse olasılığı)');
  }
  if (observed.runtimeMarkerSha256 !== record.runtimeMarkerSha256) {
    mismatches.push('runtime marker fingerprint farklı');
  }

  if (mismatches.length > 0) {
    return {
      owned: false,
      reason: mismatches.join('; '),
      errorCode: 'PROCESS_OWNERSHIP_MISMATCH',
    };
  }

  return { owned: true };
}

/**
 * Sonlandırma kararı. Bu fonksiyon bilinçli olarak saftır: gerçek sonlandırma
 * execution backend'in işidir. Karar ile eylemi ayırmak, "bilinmeyen PID
 * körlemesine öldürülmez" kuralını test edilebilir kılar (ST-PROC-003).
 */
export function mayTerminate(record: OwnershipRecord, observed: ProcessFingerprint | null): boolean {
  if (observed === null) return false; // sonlanmış; yapılacak bir şey yok
  return verifyOwnership(record, observed).owned;
}
