/**
 * Run-supervisor modül giriş noktası.
 *
 * Tek bir index modülü üzerinden Supervisor bileşenlerinin tiplerini ve
 * sınıflarını yeniden dışa aktarır.
 */

import { verifyOwnership, mayTerminate } from './ownership.js';
import type { OwnershipRecord, ProcessFingerprint } from './ownership.js';
export { verifyOwnership, mayTerminate };
export type { OwnershipRecord, ProcessFingerprint } from './ownership.js';

export { assertBackendPairing, BackendSecurityDowngradeError } from './backend.js';
export type { ExecutionBackend } from './backend.js';

export { RuntimeRegistry } from './runtime-registry.js';
export { RuntimePool } from './runtime-pool.js';
export type { PooledRuntime } from './runtime-pool.js';
export { PermissionAdapter } from './permission-adapter.js';
export { PerformanceProfiler } from './performance-profiler.js';
export { CowFixtureManager } from './cow-fixture.js';
export { EventSubscriptionManager } from './event-subscription.js';
export { SupervisorService } from './service.js';
export { SupervisorIpcServer, toIpcError } from './ipc-server.js';

/**
 * Startup recovery — geçmiş oturumdan kalan ownership kayıtlarını temizler.
 *
 * M2 ST-RECOVERY-001 kuralı: bir kayıt canlı PID'ye aitse reclaimed olur;
 * başka bir process'e aitse ORPHANED işaretlenir ve ÖLDÜRÜLMEZ.
 * Burada ownership doğrulaması (4 alan) zaten ownership.ts'de yapıldığı için
 * bu fonksiyon yalnızca kuyruğu dağıtır.
 */
export function runStartupRecovery(
  records: OwnershipRecord[],
  lookupFingerprint: (pid: number) => ProcessFingerprint | null,
): { reclaimed: OwnershipRecord[]; orphaned: OwnershipRecord[] } {
  const reclaimed: OwnershipRecord[] = [];
  const orphaned: OwnershipRecord[] = [];

  for (const record of records) {
    const fp = lookupFingerprint(record.pid);
    if (fp === null) {
      // Process sonlanmış; kayıt artık ORPHANED değil RECLAIMED sayılır
      // çünkü körlemesine öldürme yasağı (ST-PROC-003) zaten koruyor.
      reclaimed.push(record);
      continue;
    }
    const verdict = verifyOwnership(record, fp);
    if (verdict.owned) {
      reclaimed.push(record);
    } else {
      orphaned.push(record);
    }
  }

  return { reclaimed, orphaned };
}
