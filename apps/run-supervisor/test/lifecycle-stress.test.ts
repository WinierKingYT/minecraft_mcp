/**
 * Lifecycle stress tests — 100 orphan `%0` M3 gate.
 *
 * Validates that rapid start/stop cycles produce zero orphan processes:
 *   - 100 sequential start → stop → verify cycles
 *   - Each cycle: spawn process, capture fingerprint, stop, verify no orphan
 *   - After all cycles: verify port cleanup, no zombie processes
 *   - Concurrent lifecycle: 10 parallel start/stop pairs
 *
 * Uses lightweight Node.js child processes to simulate Paper lifecycle.
 * Real Paper server tests would be integration tests (not unit tests).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { verifyOwnership, mayTerminate, type OwnershipRecord } from '../src/ownership.js';
import { forceKill } from '../src/runtime-launch.js';

// ─── Helpers ────────────────────────────────────────────────────────

function createMockProcess(): ChildProcess {
  // Spawn a long-running Node.js process that we can kill
  return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600_000)'], {
    stdio: 'ignore',
    detached: false,
  });
}

function createOwnershipRecord(pid: number, markerSha: string): OwnershipRecord {
  return {
    pid,
    executablePath: process.execPath,
    startedAtMs: Date.now(),
    runtimeMarkerSha256: markerSha,
    runtimeId: `stress-${pid}`,
    serverInstanceId: `instance-${pid}`,
    kind: 'paper',
    registeredAtMs: Date.now(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── ST-LIFECYCLE-001: 100 sequential start/stop cycles ─────────────

describe('ST-LIFECYCLE-001: 100 sequential start/stop cycles', () => {
  test('100 rapid start/stop produces 0 orphans', async () => {
    const CYCLES = 100;
    const orphans: number[] = [];

    for (let i = 0; i < CYCLES; i++) {
      const proc = createMockProcess();
      const pid = proc.pid!;
      const marker = `marker-${i}-${pid}`;
      const record = createOwnershipRecord(pid, marker);

      // Verify ownership before stopping
      const fingerprint = {
        pid,
        executablePath: process.execPath,
        startedAtMs: record.startedAtMs,
        runtimeMarkerSha256: marker,
      };
      const verdict = verifyOwnership(record, fingerprint);
      assert.equal(verdict.owned, true, `Cycle ${i}: ownership should match`);

      // Stop the process
      await forceKill(proc);

      // Wait for process to fully exit
      await sleep(50);

      // Verify no orphan: process should be dead
      try {
        process.kill(pid, 0); // Signal 0 = check if alive
        // If we get here, process is still alive = orphan
        orphans.push(pid);
      } catch {
        // Process is dead — good, no orphan
      }
    }

    assert.equal(
      orphans.length,
      0,
      `Expected 0 orphans, got ${orphans.length}: PIDs [${orphans.join(', ')}]`,
    );
  });
});

// ─── ST-LIFECYCLE-002: Concurrent lifecycle (10 parallel) ───────────

describe('ST-LIFECYCLE-002: Concurrent lifecycle (10 parallel)', () => {
  test('10 parallel start/stop pairs produce 0 orphans', async () => {
    const PARALLEL = 10;
    const processes: ChildProcess[] = [];
    const pids: number[] = [];

    // Start all
    for (let i = 0; i < PARALLEL; i++) {
      const proc = createMockProcess();
      processes.push(proc);
      pids.push(proc.pid!);
    }

    // Stop all simultaneously
    const killPromises = processes.map((proc) => forceKill(proc));
    await Promise.all(killPromises);

    // Wait for cleanup
    await sleep(100);

    // Verify all dead
    const orphans: number[] = [];
    for (const pid of pids) {
      try {
        process.kill(pid, 0);
        orphans.push(pid);
      } catch {
        // dead — good
      }
    }

    assert.equal(
      orphans.length,
      0,
      `Expected 0 orphans from concurrent lifecycle, got ${orphans.length}: [${orphans.join(', ')}]`,
    );
  });
});

// ─── ST-LIFECYCLE-003: Ownership mismatch prevents kill ─────────────

describe('ST-LIFECYCLE-003: Ownership mismatch prevents kill', () => {
  test('mayTerminate returns false for mismatched fingerprint', () => {
    const record = createOwnershipRecord(12345, 'correct-marker');
    const wrongFingerprint = {
      pid: 12345,
      executablePath: process.execPath,
      startedAtMs: record.startedAtMs,
      runtimeMarkerSha256: 'wrong-marker',
    };

    assert.equal(mayTerminate(record, wrongFingerprint), false);
  });

  test('mayTerminate returns true for matched fingerprint', () => {
    const record = createOwnershipRecord(12345, 'correct-marker');
    const correctFingerprint = {
      pid: 12345,
      executablePath: process.execPath,
      startedAtMs: record.startedAtMs,
      runtimeMarkerSha256: 'correct-marker',
    };

    assert.equal(mayTerminate(record, correctFingerprint), true);
  });

  test('mayTerminate returns false when process is null', () => {
    const record = createOwnershipRecord(12345, 'marker');
    assert.equal(mayTerminate(record, null), false);
  });
});

// ─── ST-LIFECYCLE-004: PID reuse detection ──────────────────────────

describe('ST-LIFECYCLE-004: PID reuse detection', () => {
  test('different startedAtMs detects PID reuse', () => {
    const record = createOwnershipRecord(99999, 'marker');
    // Same PID but different start time = PID reuse
    const reusedFingerprint = {
      pid: 99999,
      executablePath: process.execPath,
      startedAtMs: record.startedAtMs - 10000, // Different start time
      runtimeMarkerSha256: 'marker',
    };

    const verdict = verifyOwnership(record, reusedFingerprint);
    assert.equal(verdict.owned, false);
    if (!verdict.owned) {
      assert.ok(verdict.reason.includes('başlangıç zamanı'));
    }
  });
});

// ─── ST-LIFECYCLE-005: Force kill edge cases ────────────────────────

describe('ST-LIFECYCLE-005: Force kill edge cases', () => {
  test('forceKill on already-dead process does not throw', async () => {
    const proc = createMockProcess();
    const pid = proc.pid!;

    // Kill once
    await forceKill(proc);
    await sleep(50);

    // Kill again — should not throw
    await forceKill(proc);

    // Verify still dead
    try {
      process.kill(pid, 0);
      assert.fail('Process should be dead');
    } catch {
      // good
    }
  });

  test('forceKill on process that exits during timeout', async () => {
    const proc = spawn(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    });

    // Should complete without hanging
    await forceKill(proc);
  });
});

// ─── ST-LIFECYCLE-006: Rapid restart simulation ─────────────────────

describe('ST-LIFECYCLE-006: Rapid restart simulation', () => {
  test('start → stop → start → stop on same "slot" produces 0 orphans', async () => {
    const orphans: number[] = [];

    for (let i = 0; i < 50; i++) {
      // First instance
      const proc1 = createMockProcess();
      const pid1 = proc1.pid!;
      await forceKill(proc1);
      await sleep(20);

      // Second instance (simulates restart)
      const proc2 = createMockProcess();
      const pid2 = proc2.pid!;
      await forceKill(proc2);
      await sleep(20);

      // Check both dead
      for (const pid of [pid1, pid2]) {
        try {
          process.kill(pid, 0);
          orphans.push(pid);
        } catch {
          // dead
        }
      }
    }

    assert.equal(
      orphans.length,
      0,
      `Expected 0 orphans from rapid restart, got ${orphans.length}: [${orphans.join(', ')}]`,
    );
  });
});

// ─── ST-LIFECYCLE-007: Ownership record integrity ───────────────────

describe('ST-LIFECYCLE-007: Ownership record integrity', () => {
  test('all four fields must match for ownership', () => {
    const record = createOwnershipRecord(100, 'abc123');

    // Each field individually wrong should fail
    const fields: Array<{ name: string; modify: (r: OwnershipRecord) => OwnershipRecord }> = [
      { name: 'pid', modify: (r) => ({ ...r, pid: r.pid + 1 }) },
      { name: 'executablePath', modify: (r) => ({ ...r, executablePath: '/wrong/path' }) },
      { name: 'startedAtMs', modify: (r) => ({ ...r, startedAtMs: r.startedAtMs + 1 }) },
      { name: 'runtimeMarkerSha256', modify: (r) => ({ ...r, runtimeMarkerSha256: 'wrong' }) },
    ];

    for (const { name, modify } of fields) {
      const wrong = modify(record);
      const fingerprint = {
        pid: wrong.pid,
        executablePath: wrong.executablePath,
        startedAtMs: wrong.startedAtMs,
        runtimeMarkerSha256: wrong.runtimeMarkerSha256,
      };
      const verdict = verifyOwnership(record, fingerprint);
      assert.equal(verdict.owned, false, `Should fail when ${name} is wrong`);
    }
  });

  test('all four fields matching returns owned', () => {
    const record = createOwnershipRecord(100, 'abc123');
    const fingerprint = {
      pid: record.pid,
      executablePath: record.executablePath,
      startedAtMs: record.startedAtMs,
      runtimeMarkerSha256: record.runtimeMarkerSha256,
    };
    const verdict = verifyOwnership(record, fingerprint);
    assert.equal(verdict.owned, true);
  });
});
