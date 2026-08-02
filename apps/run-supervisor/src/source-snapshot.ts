/**
 * Source snapshot — değişmez kaynak durumu.
 *
 * docs/architecture/trust-and-snapshot.md SN-01..SN-07:
 *   SN-01 Build aynı source_snapshot_id üzerinden çalışır
 *   SN-02 Workspace build sırasında değişirse SOURCE_CHANGED_DURING_BUILD
 *   SN-03 Manifest relative path, size, mode ve checksum içerir
 *   SN-04 Symlink default olarak reddedilir
 *   SN-07 Snapshot'tan artifact'e provenance zorunludur
 *
 * SN-02 sessizce tolere edilemez: aksi hâlde rapor, gerçekte derlenmeyen bir
 * kaynak durumuna atıfta bulunur ve KPI-09 anlamsızlaşır.
 */

import { createHash, randomBytes } from 'node:crypto';
import { readdir, lstat, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative, sep } from 'node:path';
import type { RegisteredProject } from './project-registry.js';

const execFileAsync = promisify(execFile);

export class SnapshotError extends Error {
  constructor(
    readonly code: 'SOURCE_CHANGED_DURING_BUILD' | 'SYMLINK_NOT_ALLOWED' | 'DIRTY_WORKSPACE_REJECTED',
    message: string,
  ) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** Snapshot dışında bırakılan yollar. Türetilmiş çıktı ve VCS iç durumu. */
export const DEFAULT_EXCLUDED_PATHS: readonly string[] = [
  '.git',
  '.gradle',
  'build',
  '.idea',
  '.vscode',
  'node_modules',
  '.mcpdev-data',
];

export interface SnapshotEntry {
  /** Kök'e göre, POSIX ayırıcılı yol — platformlar arası kararlılık için. */
  readonly path: string;
  readonly size: number;
  /** Yalnızca çalıştırılabilirlik biti anlamlıdır; tam mode platforma bağlıdır. */
  readonly executable: boolean;
  readonly sha256: string;
}

export interface GitInfo {
  readonly available: boolean;
  readonly commit: string | null;
  readonly branch: string | null;
  readonly dirty: boolean;
  readonly dirtyDiffSha256: string | null;
}

export interface SourceSnapshot {
  readonly sourceSnapshotId: string;
  readonly projectId: string;
  readonly canonicalRootFingerprint: string;
  readonly git: GitInfo;
  readonly inputManifestSha256: string;
  readonly excludedPaths: readonly string[];
  readonly entries: readonly SnapshotEntry[];
  readonly createdAt: string;
}

export interface SnapshotOptions {
  readonly excludedPaths?: readonly string[];
  /** CI profilinde kirli workspace reddedilir (SN-06). */
  readonly rejectDirty?: boolean;
  readonly maxEntries?: number;
  readonly maxTotalBytes?: number;
}

const DEFAULT_MAX_ENTRIES = 20_000;
const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024;

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

/** Kaynak ağacını gezer ve deterministik bir manifest üretir. */
async function collectEntries(
  root: string,
  excluded: ReadonlySet<string>,
  limits: { maxEntries: number; maxTotalBytes: number },
): Promise<SnapshotEntry[]> {
  const entries: SnapshotEntry[] = [];
  let totalBytes = 0;

  async function walk(dir: string): Promise<void> {
    // `withFileTypes` symlink'leri ayırt eder; lstat semantiği korunur.
    const children = await readdir(dir, { withFileTypes: true });
    // Sıralama determinizm içindir: manifest hash'i dizin okuma sırasına
    // bağlı olmamalıdır.
    children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const child of children) {
      const full = join(dir, child.name);
      const rel = toPosix(relative(root, full));

      if (excluded.has(rel) || excluded.has(child.name)) {
        continue;
      }

      if (child.isSymbolicLink()) {
        throw new SnapshotError(
          'SYMLINK_NOT_ALLOWED',
          `Snapshot içinde symlink bulundu: ${rel}. Symlink varsayılan olarak reddedilir (SN-04).`,
        );
      }

      if (child.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!child.isFile()) {
        // Soket, FIFO, aygıt: kaynak ağacında olmamalı.
        continue;
      }

      const stats = await lstat(full);
      totalBytes += stats.size;
      if (entries.length >= limits.maxEntries) {
        throw new SnapshotError(
          'SOURCE_CHANGED_DURING_BUILD',
          `Snapshot dosya sayısı limitini aştı (${limits.maxEntries}).`,
        );
      }
      if (totalBytes > limits.maxTotalBytes) {
        throw new SnapshotError(
          'SOURCE_CHANGED_DURING_BUILD',
          `Snapshot toplam boyut limitini aştı (${limits.maxTotalBytes} bayt).`,
        );
      }

      const content = await readFile(full);
      entries.push({
        path: rel,
        size: stats.size,
        // Windows'ta çalıştırılabilirlik biti yoktur; alan yine de taşınır ki
        // POSIX'te üretilen manifest aynı şemayı kullansın.
        executable: (stats.mode & 0o111) !== 0,
        sha256: createHash('sha256').update(content).digest('hex'),
      });
    }
  }

  await walk(root);
  return entries;
}

/** Manifest'ten deterministik bir fingerprint üretir. */
export function fingerprintEntries(entries: readonly SnapshotEntry[]): string {
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(entry.path);
    hash.update('\0');
    hash.update(String(entry.size));
    hash.update('\0');
    hash.update(entry.executable ? '1' : '0');
    hash.update('\0');
    hash.update(entry.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}

async function readGitInfo(root: string): Promise<GitInfo> {
  const run = async (args: string[]): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd: root, timeout: 10_000 });
      return stdout.trim();
    } catch {
      return null;
    }
  };

  const commit = await run(['rev-parse', 'HEAD']);
  if (commit === null) {
    return { available: false, commit: null, branch: null, dirty: false, dirtyDiffSha256: null };
  }

  const branch = await run(['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = await run(['status', '--porcelain']);
  const dirty = status !== null && status !== '';

  let dirtyDiffSha256: string | null = null;
  if (dirty) {
    const diff = await run(['diff', 'HEAD']);
    dirtyDiffSha256 = diff === null ? null : createHash('sha256').update(diff).digest('hex');
  }

  return { available: true, commit, branch, dirty, dirtyDiffSha256 };
}

export async function createSourceSnapshot(
  project: RegisteredProject,
  options: SnapshotOptions = {},
): Promise<SourceSnapshot> {
  const excluded = new Set(options.excludedPaths ?? DEFAULT_EXCLUDED_PATHS);

  const entries = await collectEntries(project.canonicalRoot, excluded, {
    maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
  });

  const git = await readGitInfo(project.canonicalRoot);

  if (options.rejectDirty === true && git.dirty) {
    throw new SnapshotError(
      'DIRTY_WORKSPACE_REJECTED',
      'CI profilinde kirli workspace kabul edilmez. Değişiklikleri commit edin veya pinned-source kullanın.',
    );
  }

  const inputManifestSha256 = fingerprintEntries(entries);

  return {
    sourceSnapshotId: `src_${randomBytes(12).toString('hex')}`,
    projectId: project.id,
    // Kök fingerprint'i, kökün kimliğini manifest'ten ayrı taşır: aynı içerik
    // farklı bir projeden gelmiş olabilir.
    canonicalRootFingerprint: createHash('sha256').update(project.canonicalRoot).digest('hex'),
    git,
    inputManifestSha256,
    excludedPaths: [...excluded],
    entries,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Snapshot'ın hâlâ geçerli olduğunu doğrular.
 *
 * Build başlamadan önce ve bittikten sonra çağrılır. Değişiklik varsa
 * SOURCE_CHANGED_DURING_BUILD üretilir — build çıktısı atılır, çünkü rapor
 * aksi hâlde derlenmeyen bir kaynağa atıfta bulunurdu.
 */
export async function assertSnapshotUnchanged(
  project: RegisteredProject,
  snapshot: SourceSnapshot,
): Promise<void> {
  const entries = await collectEntries(project.canonicalRoot, new Set(snapshot.excludedPaths), {
    maxEntries: DEFAULT_MAX_ENTRIES,
    maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
  });

  const current = fingerprintEntries(entries);
  if (current !== snapshot.inputManifestSha256) {
    const changed = diffEntries(snapshot.entries, entries);
    throw new SnapshotError(
      'SOURCE_CHANGED_DURING_BUILD',
      `Kaynak workspace snapshot alındıktan sonra değişti.\n` +
        `  snapshot: ${snapshot.inputManifestSha256}\n  şu an   : ${current}\n` +
        `  değişen : ${changed.slice(0, 10).join(', ')}${changed.length > 10 ? ` (+${changed.length - 10})` : ''}`,
    );
  }
}

/** Teşhis için: hangi dosyaların değiştiği. */
export function diffEntries(
  before: readonly SnapshotEntry[],
  after: readonly SnapshotEntry[],
): string[] {
  const beforeMap = new Map(before.map((e) => [e.path, e.sha256]));
  const afterMap = new Map(after.map((e) => [e.path, e.sha256]));
  const changed: string[] = [];

  for (const [path, sha] of afterMap) {
    const previous = beforeMap.get(path);
    if (previous === undefined) {
      changed.push(`+${path}`);
    } else if (previous !== sha) {
      changed.push(`~${path}`);
    }
  }
  for (const path of beforeMap.keys()) {
    if (!afterMap.has(path)) {
      changed.push(`-${path}`);
    }
  }
  return changed.sort();
}
