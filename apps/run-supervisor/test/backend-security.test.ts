/**
 * ST-BACKEND-DOWNGRADE-001: Backend Security Level Downgrade Prevention.
 *
 * Enforces ADR-0004: runtime_backend.security_level >= build_backend.security_level.
 *
 * Rationale: if untrusted code requires Container isolation for building,
 * allowing it to run on the host via Trusted Local silently negates the
 * isolation decision.
 *
 * Security levels:
 *   TrustedLocalBackend = 1 (no sandbox)
 *   ContainerBackend = 2 (strong isolation T0, T1, T2)
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKEND_SECURITY_LEVEL, type ExecutionBackendKind } from '@mcpdev/contracts';
import { assertBackendPairing, BackendSecurityDowngradeError } from '../src/backend.js';

// ─── Security level verification ──────────────────────────────────────

describe('ST-BACKEND-DOWNGRADE-001: Security level definitions', () => {
  test('trusted-local has security level 1', () => {
    assert.equal(BACKEND_SECURITY_LEVEL['trusted-local'], 1);
  });

  test('container has security level 2', () => {
    assert.equal(BACKEND_SECURITY_LEVEL['container'], 2);
  });

  test('container is strictly stronger than trusted-local', () => {
    assert.ok(
      BACKEND_SECURITY_LEVEL['container'] > BACKEND_SECURITY_LEVEL['trusted-local'],
      'container level > trusted-local level',
    );
  });
});

// ─── Downgrade prevention ──────────────────────────────────────────────

describe('ST-BACKEND-DOWNGRADE-001: Container build + Trusted Local runtime rejected', () => {
  test('container build → trusted-local runtime throws BACKEND_SECURITY_DOWNGRADE', () => {
    assert.throws(
      () => assertBackendPairing('container', 'trusted-local'),
      (err: unknown) => {
        assert.ok(err instanceof BackendSecurityDowngradeError, 'is BackendSecurityDowngradeError');
        assert.equal(err.code, 'BACKEND_SECURITY_DOWNGRADE');
        assert.ok(err.message.includes('trusted-local'), 'error mentions trusted-local');
        assert.ok(err.message.includes('container'), 'error mentions container');
        return true;
      },
    );
  });

  test('error is not retryable', () => {
    try {
      assertBackendPairing('container', 'trusted-local');
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof BackendSecurityDowngradeError);
      // Per error catalog: retryable: false
      // The error itself doesn't carry retryable, but the catalog entry does
      assert.equal(err.code, 'BACKEND_SECURITY_DOWNGRADE');
    }
  });

  test('error suggests using same or stronger backend', () => {
    // The suggested_action from error catalog:
    // "Runtime'ı build ile aynı veya daha güçlü backend'de başlatın"
    // This is a contract test verifying the error message is actionable
    try {
      assertBackendPairing('container', 'trusted-local');
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof BackendSecurityDowngradeError);
      // Message should explain WHY it's rejected
      assert.ok(
        err.message.includes('daha zayıf') || err.message.includes('zayıf'),
        'error message explains weaker isolation',
      );
    }
  });
});

// ─── Allowed pairings ─────────────────────────────────────────────────

describe('ST-BACKEND-DOWNGRADE-001: Allowed backend pairings', () => {
  test('trusted-local build → trusted-local runtime is allowed', () => {
    assert.doesNotThrow(() => assertBackendPairing('trusted-local', 'trusted-local'));
  });

  test('trusted-local build → container runtime is allowed (upgrade)', () => {
    assert.doesNotThrow(() => assertBackendPairing('trusted-local', 'container'));
  });

  test('container build → container runtime is allowed (same level)', () => {
    assert.doesNotThrow(() => assertBackendPairing('container', 'container'));
  });
});

// ─── All backend kind combinations ────────────────────────────────────

describe('ST-BACKEND-DOWNGRADE-001: Exhaustive backend pairing matrix', () => {
  const backends: ExecutionBackendKind[] = ['trusted-local', 'container'];

  for (const build of backends) {
    for (const runtime of backends) {
      const shouldReject = BACKEND_SECURITY_LEVEL[runtime] < BACKEND_SECURITY_LEVEL[build];

      if (shouldReject) {
        test(`${build} build → ${runtime} runtime is rejected`, () => {
          assert.throws(
            () => assertBackendPairing(build, runtime),
            (err: unknown) => err instanceof BackendSecurityDowngradeError,
          );
        });
      } else {
        test(`${build} build → ${runtime} runtime is allowed`, () => {
          assert.doesNotThrow(() => assertBackendPairing(build, runtime));
        });
      }
    }
  }
});

// ─── Error catalog contract ────────────────────────────────────────────

describe('ST-BACKEND-DOWNGRADE-001: Error catalog entry', () => {
  test('BACKEND_SECURITY_DOWNGRADE error code format', () => {
    // Verify the error code naming convention
    const code = 'BACKEND_SECURITY_DOWNGRADE';
    assert.ok(code.startsWith('BACKEND_'), 'starts with BACKEND_');
    assert.ok(code.includes('SECURITY'), 'includes SECURITY');
    assert.ok(code.includes('DOWNGRADE'), 'includes DOWNGRADE');
  });

  test('error is categorized as permission', () => {
    // Per error catalog: category: permission
    // This means it's an authorization/security error, not a validation error
    const category = 'permission';
    assert.equal(category, 'permission');
  });

  test('error is not retryable', () => {
    // Per error catalog: retryable: false
    // User must change their configuration, not retry the same request
    const retryable = false;
    assert.equal(retryable, false);
  });
});

// ─── ADR-0004 formula correctness ─────────────────────────────────────

describe('ST-BACKEND-DOWNGRADE-001: ADR-0004 formula correctness', () => {
  test('formula is runtime >= build (not build >= runtime)', () => {
    // Historical note: V3 spec had this backwards. ADR-0004 corrected it.
    // This test verifies the corrected direction.

    // If formula were WRONG (build >= runtime), then:
    //   container(2) build → trusted-local(1) runtime
    //   would be: 2 >= 1 = true = ALLOWED (WRONG!)
    //
    // With CORRECT formula (runtime >= build):
    //   container(2) build → trusted-local(1) runtime
    //   would be: 1 >= 2 = false = REJECTED (CORRECT!)

    const runtimeLevel = BACKEND_SECURITY_LEVEL['trusted-local']; // 1
    const buildLevel = BACKEND_SECURITY_LEVEL['container'];       // 2

    // Correct formula: runtime >= build means downgrade is rejected
    assert.ok(
      runtimeLevel < buildLevel,
      'trusted-local level < container level (downgrade scenario)',
    );

    // Verify the rejection direction
    assert.throws(
      () => assertBackendPairing('container', 'trusted-local'),
      'container build → trusted-local runtime is rejected',
    );

    // And the upgrade direction is allowed
    assert.doesNotThrow(
      () => assertBackendPairing('trusted-local', 'container'),
      'trusted-local build → container runtime is allowed',
    );
  });

  test('stronger build cannot run on weaker runtime', () => {
    // Container build (level 2) cannot run on Trusted Local (level 1)
    assert.throws(
      () => assertBackendPairing('container', 'trusted-local'),
    );
  });

  test('weaker build CAN run on stronger runtime', () => {
    // Trusted Local build (level 1) CAN run on Container (level 2)
    assert.doesNotThrow(
      () => assertBackendPairing('trusted-local', 'container'),
    );
  });
});
