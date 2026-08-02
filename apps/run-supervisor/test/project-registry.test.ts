/**
 * ST-PATH-001..004, UT-PROJECT-* — proje kaydı ve path confinement.
 *
 * Bu testler negatiftir: beklenen sonuç açık hata kodu ve güvenli durumdur,
 * "çökmedi" değil.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRegistry, ProjectError, assertInsideRoot } from '../src/project-registry.js';

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'proj-'));
  await mkdir(join(root, 'src', 'main'), { recursive: true });
  await writeFile(join(root, 'src', 'main', 'App.java'), 'class App {}');
  return root;
}

async function registry(root: string, overrides: Partial<Parameters<ProjectRegistry['register']>[1]> = {}) {
  const reg = new ProjectRegistry();
  await reg.register('claim-plugin', {
    canonicalRoot: root,
    trustLevel: 'developer-workspace',
    allowedBackends: ['trusted-local', 'container'],
    defaultBackend: 'container',
    ...overrides,
  });
  return reg;
}

test('kayıtlı olmayan proje açık hata üretir', async () => {
  const reg = new ProjectRegistry();

  assert.throws(
    () => reg.get('yok'),
    (err: unknown) => {
      assert.ok(err instanceof ProjectError);
      assert.equal(err.code, 'PROJECT_NOT_REGISTERED');
      assert.match(err.message, /mutlak path kabul etmez/);
      return true;
    },
  );
});

test('mutlak path araç girdisi olarak reddedilir', async () => {
  const root = await workspace();
  const reg = await registry(root);

  await assert.rejects(
    () => reg.resolveInside('claim-plugin', join(root, 'src')),
    (err: unknown) => err instanceof ProjectError && err.code === 'PATH_OUTSIDE_ROOT',
  );
});

test('`../` ile kök dışına çıkma reddedilir', async () => {
  const root = await workspace();
  const reg = await registry(root);

  await assert.rejects(
    () => reg.resolveInside('claim-plugin', join('..', '..', 'etc', 'passwd')),
    (err: unknown) => err instanceof ProjectError && err.code === 'PATH_OUTSIDE_ROOT',
  );
});

test('kök içindeki geçerli yol çözülür', async () => {
  const root = await workspace();
  const reg = await registry(root);

  const resolved = await reg.resolveInside('claim-plugin', join('src', 'main', 'App.java'));
  assert.ok(resolved.endsWith(join('src', 'main', 'App.java')));
});

test('yol üzerindeki symlink reddedilir', async (t) => {
  const root = await workspace();
  const outside = await mkdtemp(join(tmpdir(), 'outside-'));
  await writeFile(join(outside, 'secret.txt'), 'gizli');

  try {
    await symlink(outside, join(root, 'linked'), 'junction');
  } catch {
    // Windows'ta symlink oluşturma yetki gerektirebilir.
    t.skip('symlink/junction oluşturulamadı (yetki yok)');
    return;
  }

  const reg = await registry(root);

  // Ara bileşen symlink: yalnızca son bileşeni denetlemek yetmezdi.
  await assert.rejects(
    () => reg.resolveInside('claim-plugin', join('linked', 'secret.txt')),
    (err: unknown) => err instanceof ProjectError && err.code === 'SYMLINK_NOT_ALLOWED',
  );
});

test('symlink olan proje kökü kaydedilemez', async (t) => {
  const real = await workspace();
  const linkParent = await mkdtemp(join(tmpdir(), 'linkparent-'));
  const link = join(linkParent, 'link');

  try {
    await symlink(real, link, 'junction');
  } catch {
    t.skip('symlink/junction oluşturulamadı (yetki yok)');
    return;
  }

  const reg = new ProjectRegistry();
  await assert.rejects(
    () =>
      reg.register('claim-plugin', {
        canonicalRoot: link,
        trustLevel: 'developer-workspace',
        allowedBackends: ['container'],
        defaultBackend: 'container',
      }),
    (err: unknown) => err instanceof ProjectError && err.code === 'SYMLINK_NOT_ALLOWED',
  );
});

test('untrusted ve revoked build çalıştıramaz', async () => {
  const root = await workspace();

  for (const level of ['untrusted', 'revoked'] as const) {
    const reg = new ProjectRegistry();
    await reg.register('claim-plugin', {
      canonicalRoot: root,
      trustLevel: level,
      allowedBackends: ['container'],
      defaultBackend: 'container',
    });

    assert.throws(
      () => reg.assertBuildAllowed('claim-plugin'),
      (err: unknown) => {
        assert.ok(err instanceof ProjectError);
        assert.equal(err.code, 'TRUST_LEVEL_INSUFFICIENT');
        return true;
      },
      `${level} build çalıştırabiliyor (!)`,
    );
  }
});

test('build çalıştırabilen trust seviyeleri kabul edilir', async () => {
  const root = await workspace();

  for (const level of ['developer-workspace', 'pinned-source', 'approved-fixture'] as const) {
    const reg = new ProjectRegistry();
    await reg.register('claim-plugin', {
      canonicalRoot: root,
      trustLevel: level,
      allowedBackends: ['container'],
      defaultBackend: 'container',
    });
    assert.doesNotThrow(() => reg.assertBuildAllowed('claim-plugin'));
  }
});

test('izinli olmayan backend reddedilir', async () => {
  const root = await workspace();
  const reg = new ProjectRegistry();
  await reg.register('claim-plugin', {
    canonicalRoot: root,
    trustLevel: 'developer-workspace',
    allowedBackends: ['container'],
    defaultBackend: 'container',
  });

  assert.throws(
    () => reg.assertBackendAllowed('claim-plugin', 'trusted-local'),
    (err: unknown) => err instanceof ProjectError && err.code === 'TRUST_LEVEL_INSUFFICIENT',
  );
  assert.doesNotThrow(() => reg.assertBackendAllowed('claim-plugin', 'container'));
});

test('default_backend allowed_backends içinde olmalıdır', async () => {
  const root = await workspace();
  const reg = new ProjectRegistry();

  await assert.rejects(
    () =>
      reg.register('claim-plugin', {
        canonicalRoot: root,
        trustLevel: 'developer-workspace',
        allowedBackends: ['container'],
        defaultBackend: 'trusted-local',
      }),
    (err: unknown) => err instanceof ProjectError && err.code === 'CONFIG_INVALID',
  );
});

test('geçersiz project_id reddedilir', async () => {
  const root = await workspace();
  const reg = new ProjectRegistry();

  for (const id of ['Claim_Plugin', '../evil', '', '1plugin']) {
    await assert.rejects(
      () =>
        reg.register(id, {
          canonicalRoot: root,
          trustLevel: 'developer-workspace',
          allowedBackends: ['container'],
          defaultBackend: 'container',
        }),
      (err: unknown) => err instanceof ProjectError && err.code === 'CONFIG_INVALID',
      `"${id}" kabul edildi (!)`,
    );
  }
});

test('assertInsideRoot kök eşitliğini kabul eder, dışarıyı reddeder', () => {
  assert.doesNotThrow(() => assertInsideRoot('/a/b', '/a/b'));
  assert.doesNotThrow(() => assertInsideRoot('/a/b', '/a/b/c'));
  assert.throws(() => assertInsideRoot('/a/b', '/a/c'));
  // Ön ek benzerliği kök altında olmak DEĞİLDİR.
  assert.throws(() => assertInsideRoot('/a/b', '/a/bc'));
});
