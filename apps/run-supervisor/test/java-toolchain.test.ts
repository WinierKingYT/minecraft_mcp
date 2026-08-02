/**
 * UT-JAVA-TOOLCHAIN-001 — Java sürüm tespiti ve JAVA_VERSION_MISMATCH.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJavaMajor, assertJavaMajor, JavaToolchainError, type JavaInstallation } from '../src/java-toolchain.js';

test('modern sürüm dizesinden major okunur', () => {
  const output = 'openjdk version "25.0.4" 2026-01-20\nOpenJDK Runtime Environment Temurin-25.0.4.7';
  assert.equal(parseJavaMajor(output), 25);
});

test('Java 8 tarzı "1.8.0_481" dizesi 8 olarak okunur', () => {
  // Bu ayrım önemlidir: naif bir ayrıştırıcı JRE 8'i "sürüm 1" sanar ve
  // major kontrolü sessizce yanlış çalışır.
  const output = 'java version "1.8.0_481"\nJava(TM) SE Runtime Environment';
  assert.equal(parseJavaMajor(output), 8);
});

test('sürüm dizesi yoksa null döner', () => {
  assert.equal(parseJavaMajor('command not found'), null);
});

test('major uyuşmazlığı JAVA_VERSION_MISMATCH üretir ve aksiyon önerir', () => {
  const installation: JavaInstallation = {
    executable: 'C:/Program Files/Java/jdk-21/bin/java.exe',
    major: 21,
    versionString: 'openjdk version "21.0.9"',
  };

  assert.throws(
    () => assertJavaMajor(installation, 25),
    (err: unknown) => {
      assert.ok(err instanceof JavaToolchainError);
      assert.equal(err.code, 'JAVA_VERSION_MISMATCH');
      assert.match(err.message, /Java 25 gerekiyor, bulunan 21/);
      assert.match(err.message, /Önerilen aksiyon/, 'KPI-08: hata önerilen aksiyon taşımalı');
      return true;
    },
  );
});

test('doğru major kabul edilir', () => {
  const installation: JavaInstallation = {
    executable: 'java',
    major: 25,
    versionString: 'openjdk version "25.0.4"',
  };
  assert.doesNotThrow(() => assertJavaMajor(installation, 25));
});
