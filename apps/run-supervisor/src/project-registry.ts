/**
 * Proje kaydı ve trust store.
 *
 * docs/architecture/trust-and-snapshot.md:
 *   - Kullanıcı aracı keyfî path ile çağıramaz; önce proje kaydedilir.
 *   - Araçlar yalnızca `project_id` alır (FS-01, FS-02).
 *   - Trust kaydı proje klasörünün İÇİNDE tutulmaz — aksi hâlde projeye yazma
 *     yetkisi olan kod kendi trust seviyesini yükseltebilirdi.
 */

import { lstat, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { TrustLevel, ExecutionBackendKind } from '@mcpdev/contracts';

export class ProjectError extends Error {
  constructor(
    readonly code:
      | 'PROJECT_NOT_REGISTERED'
      | 'TRUST_LEVEL_INSUFFICIENT'
      | 'PATH_OUTSIDE_ROOT'
      | 'SYMLINK_NOT_ALLOWED'
      | 'CONFIG_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'ProjectError';
  }
}

export interface RegisteredProject {
  readonly id: string;
  /** Kayıt anında çözümlenmiş canonical kök. */
  readonly canonicalRoot: string;
  readonly trustLevel: TrustLevel;
  readonly allowedBackends: readonly ExecutionBackendKind[];
  readonly defaultBackend: ExecutionBackendKind;
  readonly registeredAt: string;
}

export interface ProjectDefinition {
  readonly canonicalRoot: string;
  readonly trustLevel: TrustLevel;
  readonly allowedBackends: readonly ExecutionBackendKind[];
  readonly defaultBackend: ExecutionBackendKind;
}

/** Build çalıştırabilen trust seviyeleri. */
const BUILD_CAPABLE: ReadonlySet<TrustLevel> = new Set<TrustLevel>([
  'developer-workspace',
  'pinned-source',
  'approved-fixture',
]);

export class ProjectRegistry {
  readonly #projects = new Map<string, RegisteredProject>();

  /**
   * Projeyi kaydeder.
   *
   * Kök, kayıt anında canonical biçime çevrilir ve symlink olmadığı doğrulanır.
   * Sonraki her erişimde yeniden doğrulanır: kayıt sonrası kökün symlink'e
   * çevrilmesi sessizce kabul edilmemelidir.
   */
  async register(id: string, definition: ProjectDefinition): Promise<RegisteredProject> {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new ProjectError('CONFIG_INVALID', `Geçersiz project_id: "${id}" (küçük harf, rakam ve tire)`);
    }
    if (!definition.allowedBackends.includes(definition.defaultBackend)) {
      throw new ProjectError(
        'CONFIG_INVALID',
        `"${id}": default_backend "${definition.defaultBackend}" allowed_backends listesinde yok.`,
      );
    }

    const canonicalRoot = await canonicalize(definition.canonicalRoot);

    const project: RegisteredProject = {
      id,
      canonicalRoot,
      trustLevel: definition.trustLevel,
      allowedBackends: [...definition.allowedBackends],
      defaultBackend: definition.defaultBackend,
      registeredAt: new Date().toISOString(),
    };
    this.#projects.set(id, project);
    return project;
  }

  get(projectId: string): RegisteredProject {
    const project = this.#projects.get(projectId);
    if (!project) {
      throw new ProjectError(
        'PROJECT_NOT_REGISTERED',
        `Bu project_id kayıtlı değil: "${projectId}". Projeyi ürün config'inde kaydedin; araçlar mutlak path kabul etmez.`,
      );
    }
    return project;
  }

  list(): RegisteredProject[] {
    return [...this.#projects.values()];
  }

  /**
   * Projenin verilen operation için yeterli trust seviyesinde olduğunu doğrular.
   *
   * `revoked` ve `untrusted` hiçbir build operation'ı çalıştıramaz.
   */
  assertBuildAllowed(projectId: string): RegisteredProject {
    const project = this.get(projectId);
    if (!BUILD_CAPABLE.has(project.trustLevel)) {
      throw new ProjectError(
        'TRUST_LEVEL_INSUFFICIENT',
        `"${projectId}" trust seviyesi "${project.trustLevel}"; build çalıştırılamaz. ` +
          'Trust seviyesini kullanıcı olarak yükseltin; trust kaydı proje klasörünün içinde tutulmaz.',
      );
    }
    return project;
  }

  assertBackendAllowed(projectId: string, backend: ExecutionBackendKind): void {
    const project = this.get(projectId);
    if (!project.allowedBackends.includes(backend)) {
      throw new ProjectError(
        'TRUST_LEVEL_INSUFFICIENT',
        `"${projectId}" için "${backend}" backend'i izinli değil. İzinliler: ${project.allowedBackends.join(', ')}`,
      );
    }
  }

  /**
   * Proje içindeki göreli bir yolu güvenle çözer.
   *
   * Üç kontrol birlikte uygulanır (FS-03, FS-04, security-tests ST-PATH-*):
   *   1. Mutlak path REDDEDİLİR — araç girdisi olamaz.
   *   2. Canonical çözümleme sonrası kök altında kalmalı.
   *   3. Yol üzerindeki hiçbir bileşen symlink/junction olmamalı.
   */
  async resolveInside(projectId: string, relativePath: string): Promise<string> {
    const project = this.get(projectId);

    if (isAbsolute(relativePath)) {
      throw new ProjectError(
        'PATH_OUTSIDE_ROOT',
        'Mutlak path kabul edilmez; proje köküne göre göreli yol verin.',
      );
    }

    // Kök hâlâ canonical mi? Kayıt sonrası symlink'e çevrilmiş olabilir.
    const currentRoot = await canonicalize(project.canonicalRoot);
    if (currentRoot !== project.canonicalRoot) {
      throw new ProjectError(
        'SYMLINK_NOT_ALLOWED',
        `"${projectId}" kökü kayıttan sonra değişti (symlink olabilir).`,
      );
    }

    const candidate = resolve(currentRoot, relativePath);
    assertInsideRoot(currentRoot, candidate);
    await assertNoSymlinkOnPath(currentRoot, candidate);
    return candidate;
  }
}

/** Yolu canonical biçime çevirir ve symlink olmadığını doğrular. */
export async function canonicalize(path: string): Promise<string> {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    throw new ProjectError('CONFIG_INVALID', `Proje kökü bulunamadı: ${absolute}`);
  }

  const stats = await lstat(absolute);
  if (stats.isSymbolicLink()) {
    // Windows'ta junction'lar da symbolic link olarak raporlanır.
    throw new ProjectError('SYMLINK_NOT_ALLOWED', `Proje kökü bir symlink/junction: ${absolute}`);
  }
  if (!stats.isDirectory()) {
    throw new ProjectError('CONFIG_INVALID', `Proje kökü dizin değil: ${absolute}`);
  }

  return realpath(absolute);
}

/** Canonical çözümleme sonrası yolun kök altında kaldığını kanıtlar. */
export function assertInsideRoot(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (rel === '') {
    return;
  }
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ProjectError('PATH_OUTSIDE_ROOT', 'Çözümlenen yol kayıtlı kökün dışında.');
  }
}

/**
 * Kökten hedefe kadar her bileşenin symlink olmadığını doğrular.
 *
 * Yalnızca son bileşeni denetlemek yetmez: ara bir dizin symlink ise yol
 * canonical kontrolünü geçip kök dışına çıkabilir.
 */
export async function assertNoSymlinkOnPath(root: string, target: string): Promise<void> {
  const rel = relative(root, target);
  if (rel === '') {
    return;
  }

  let current = root;
  for (const segment of rel.split(sep)) {
    if (segment === '') continue;
    current = resolve(current, segment);
    if (!existsSync(current)) {
      // Henüz oluşturulmamış yollar (yazma hedefi) kabul edilir; kalan
      // bileşenler de var olmadığı için denetlenecek bir şey yoktur.
      return;
    }
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) {
      throw new ProjectError(
        'SYMLINK_NOT_ALLOWED',
        `Yol üzerinde symlink/junction bulundu: ${relative(root, current)}`,
      );
    }
  }
}
