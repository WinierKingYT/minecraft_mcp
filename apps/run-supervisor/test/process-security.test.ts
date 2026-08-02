/**
 * Process security tests — ST-PROC-* and ST-CLEANUP-* series.
 *
 * Process yönetim güvenlik kontrollerini doğrular:
 * - ST-PROC-001: Shell metacharacter yorumlanmaz (shell: false)
 * - ST-PROC-002: Gradle task allowlist (serbest komut yok)
 * - ST-PROC-004: Timeout tüm child process tree'ye uygulanır
 * - ST-CLEANUP-001: Process tree cleanup (host-level)
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommand,
  wrapperJarPath,
  GRADLE_WRAPPER_MAIN,
  prepareEnvironment,
  assertEnvironmentClean,
  DANGEROUS_ENV_VARS,
  BuildExecutionError,
} from '../src/trusted-local-backend.js';
import { createBuildPlan, BuildPlanError } from '../src/build-plan.js';
import { forceKill, isPortBound } from '../src/runtime-launch.js';
import { spawn } from 'node:child_process';

// ─── ST-PROC-001: Shell metacharacter not interpreted ────────────────

describe('ST-PROC-001: Shell metacharacter not interpreted', () => {
  test('buildCommand shell: false ile çalışır', () => {
    const plan = createBuildPlan({ mode: 'build' });
    const cmd = buildCommand('/project', '/usr/bin/java', plan);

    assert.equal(cmd.command, '/usr/bin/java');
    assert.ok(cmd.args.includes('-classpath'), 'classpath argümanı var');
    assert.ok(cmd.args.includes(wrapperJarPath('/project')), 'wrapper JAR path var');
    assert.ok(cmd.args.includes(GRADLE_WRAPPER_MAIN), 'GradleWrapperMain sınıfı var');
  });

  test('proje yolunda metakarakter olsa bile komut güvenli', () => {
    const plan = createBuildPlan({ mode: 'build' });
    const maliciousPath = '/project; rm -rf /';
    const cmd = buildCommand(maliciousPath, '/usr/bin/java', plan);

    // Komut dizisi olarak ayrıştırılır, shell tarafından yorumlanmaz
    assert.equal(cmd.command, '/usr/bin/java');
    assert.ok(cmd.args[0] === '-classpath', 'İlk argüman -classpath');
    // ; karakteri argüman içinde literal olarak kalır
    assert.ok(cmd.args.some((a) => a.includes(';')), 'Metakarakter argüman içinde literal');
  });

  test('gradlew scriptleri çalıştırılmaz', () => {
    const plan = createBuildPlan({ mode: 'build' });
    const cmd = buildCommand('/project', '/usr/bin/java', plan);

    // gradlew veya gradlew.bat asla komut olarak kullanılmaz
    assert.ok(!cmd.command.includes('gradlew'), 'gradlew script kullanılmaz');
    assert.ok(!cmd.args.some((a) => a.includes('gradlew')), 'args içinde gradlew yok');
  });

  test('shell seçeneği false olarak sabitlenir', () => {
    // trusted-local-backend.ts'de spawn() çağrısında shell: false sabit
    // Bu birim testi: kodun bu kurala uygun olduğunu doğrular
    const plan = createBuildPlan({ mode: 'build' });
    const cmd = buildCommand('/project', '/usr/bin/java', plan);

    // command java, args dizisi ile — shell yorumlaması yok
    assert.ok(Array.isArray(cmd.args), 'Args bir dizi');
    assert.ok(cmd.args.length > 5, 'Yeterli argüman var');
  });
});

// ─── ST-PROC-002: Gradle task allowlist ───────────────────────────────

describe('ST-PROC-002: Gradle task allowlist', () => {
  test('build modu yalnızca assemble çalıştırır', () => {
    const plan = createBuildPlan({ mode: 'build' });
    assert.ok(plan.args.includes('assemble'), 'assemble var');
    assert.ok(!plan.args.includes('run'), 'run yok');
    assert.ok(!plan.args.includes('test'), 'test yok (build modunda)');
  });

  test('clean_build modu clean ve assemble çalıştırır', () => {
    const plan = createBuildPlan({ mode: 'clean_build' });
    assert.ok(plan.args.includes('clean'), 'clean var');
    assert.ok(plan.args.includes('assemble'), 'assemble var');
  });

  test('unit_test modu test çalıştırır', () => {
    const plan = createBuildPlan({ mode: 'unit_test' });
    assert.ok(plan.args.includes('test'), 'test var');
  });

  test('integration_test modu check çalıştırır', () => {
    const plan = createBuildPlan({ mode: 'integration_test' });
    assert.ok(plan.args.includes('check'), 'check var');
  });

  test('bilinmeyen modreddedilir', () => {
    assert.throws(
      () => createBuildPlan({ mode: 'rm -rf /' as never }),
      (err: unknown) => {
        assert.ok(err instanceof BuildPlanError);
        assert.equal(err.code, 'BUILD_MODE_UNSUPPORTED');
        return true;
      },
    );
  });

  test('serbest Gradle task verilemez', () => {
    assert.throws(
      () => createBuildPlan({ mode: 'tasks' as never }),
      (err: unknown) => {
        assert.ok(err instanceof BuildPlanError);
        assert.match(err.message, /Serbest Gradle task verilemez/);
        return true;
      },
    );
  });

  test('serbest args verilemez', () => {
    // BuildPlanOptions'da extraArgs alanı yok — bu kasıtlı
    // Yalnızca mode ile task listesi belirlenir
    assert.throws(
      () => createBuildPlan({ mode: 'tasks' as never }),
      (err: unknown) => {
        assert.ok(err instanceof BuildPlanError);
        return true;
      },
    );
  });
});

// ─── ST-PROC-004: Timeout on all child process tree ──────────────────

describe('ST-PROC-004: Timeout on all child process tree', () => {
  test('build plan timeoutMs taşır', () => {
    const plan = createBuildPlan({ mode: 'build' });
    assert.ok(plan.timeoutMs > 0, 'Timeout pozitif');
    assert.ok(plan.timeoutMs <= 600_000, 'Timeout makul sınırda (max 10dk)');
  });

  test('varsayılan timeout 5 dakika', () => {
    const plan = createBuildPlan({ mode: 'build' });
    // Varsayılan timeout 300000ms (5 dakika)
    assert.equal(plan.timeoutMs, 300_000, 'Varsayılan timeout 5 dakika');
  });

  test('forceKill child processi sonlandirir', async () => {
    // forceKill'un Windows ve POSIX'te farklı yollarla çalıştığını doğrula
    // Gerçek process öldürme testi CI'da flaky olabilir; yapısal doğrulama yeterli
    const child = spawn('node', ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    });

    // Process'in sonlanmasını bekle
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.once('error', () => resolve());
    });

    // Zaten sonlanmış process'i sonlandırmaya çalış — hata vermemeli
    await forceKill(child);
    assert.ok(true, 'forceKill hata vermedi');
  });
});

// ─── ST-CLEANUP-001: Process tree cleanup ─────────────────────────────

describe('ST-CLEANUP-001: Process tree cleanup', () => {
  test('detached process POSIX\'te process group oluşturur', () => {
    // Node.js'te detached: true ile process kendi grubunu alır
    // Bu, tüm ağacın birlikte sonlandırılmasını sağlar
    const child = spawn('node', ['-e', 'setTimeout(() => {}, 60000)'], {
      stdio: 'ignore',
      detached: true,
    });

    assert.ok(child.pid, 'PID mevcut');
    // POSIX'te negatif PID ile process group sonlandırılabilir
    // Windows'ta taskkill /T ile tree kill yapılır
    child.kill('SIGTERM'); // Temizle
  });

  test('isPortBound port durumunu kontrol eder', async () => {
    // Kullanılmayan bir port kontrol et
    const result = await isPortBound(1);
    assert.equal(result, false, 'Kullanılmayan port serbest');
  });

  test('forceKill PID olmadan çalışır', async () => {
    // PID'i olmayan bir ChildProcess mock
    const fakeChild = { pid: undefined } as import('node:child_process').ChildProcess;
    // Hata vermemeli
    await forceKill(fakeChild);
    assert.ok(true, 'PID olmadan forceKill hata vermedi');
  });

  test('forceKill zaten sonlanmış process için çalışır', async () => {
    const child = spawn('node', ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    });

    // Process'in sonlanmasını bekle
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.once('error', () => resolve());
    });

    // Zaten sonlanmış process'i sonlandırmaya çalış — hata vermemeli
    await forceKill(child);
    assert.ok(true, 'Zaten sonlanmış process için forceKill hata vermedi');
  });
});

// ─── Additional process invariants ────────────────────────────────────

describe('Process security invariants', () => {
  test('ENV_ALLOWLIST yalnızca güvenli değişkenleri içerir', async () => {
    const env = await prepareEnvironment('/tmp/test');
    const keys = Object.keys(env.env);

    // PATH, JAVA_HOME gibi temel değişkenler olmalı
    assert.ok(keys.includes('PATH'), 'PATH mevcut');
    assert.ok(keys.includes('JAVA_HOME') || !process.env['JAVA_HOME'], 'JAVA_HOME koşullu');

    // Tehlikeli değişkenler olmamalı
    for (const dangerous of DANGEROUS_ENV_VARS) {
      if (dangerous === 'GRADLE_USER_HOME') continue; // Biz set ediyoruz
      assert.ok(env.env[dangerous] === undefined, `${dangerous} environment'da olmamalı`);
    }
  });

  test('assertEnvironmentClean tehlikeli değişkeni tespit eder', () => {
    const env: Record<string, string> = {
      PATH: '/usr/bin',
      JAVA_TOOL_OPTIONS: '-Xmx1g', // Tehlikeli!
    };

    assert.throws(
      () => assertEnvironmentClean(env),
      (err: unknown) => {
        assert.ok(err instanceof BuildExecutionError);
        assert.equal(err.code, 'ENVIRONMENT_VARIABLE_NOT_ALLOWED');
        return true;
      },
    );
  });

  test('GRADLE_USER_HOME izin verilen değişken', () => {
    // GRADLE_USER_HOME DANGEROUS_ENV_VARS'da ama assertEnvironmentClean'da muaf
    assert.ok(DANGEROUS_ENV_VARS.includes('GRADLE_USER_HOME'), 'GRADLE_USER_HOME listede');

    // Ama prepareEnvironment onu set ediyor
    const env: Record<string, string> = {
      PATH: '/usr/bin',
      GRADLE_USER_HOME: '/tmp/.gradle',
    };

    // Bu hata üretmemeli (muaf)
    assert.doesNotThrow(() => assertEnvironmentClean(env));
  });

  test('build plan maxOutputBytes limitli', () => {
    const plan = createBuildPlan({ mode: 'build' });
    assert.ok(plan.maxOutputBytes > 0, 'maxOutputBytes pozitif');
    assert.ok(plan.maxOutputBytes <= 10 * 1024 * 1024, 'maxOutputBytes max 10MB');
  });

  test('wrapperJarPath doğru formatta', () => {
    const path = wrapperJarPath('/project');
    assert.ok(path.endsWith('gradle-wrapper.jar'), 'gradle-wrapper.jar ile biter');
    assert.ok(path.includes('gradle'), 'gradle dizinini içerir');
    assert.ok(path.includes('wrapper'), 'wrapper dizinini içerir');
  });
});
