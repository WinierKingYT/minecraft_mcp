/**
 * Build planı — enum tabanlı mod eşlemesi.
 *
 * docs/security/supply-chain.md: **Agent serbest Gradle task veremez.**
 * Mod bir enum'dur; task eşlemesi ürün tarafında sabittir. Serbest task
 * kabul etmek, `--init-script` veya keyfî task üzerinden tüm supply-chain
 * kontrollerini atlatmanın en kolay yolu olurdu.
 */

export type BuildMode = 'build' | 'unit_test' | 'integration_test' | 'clean_build';

export type NetworkPolicy = 'offline' | 'repository-allowlist';

export class BuildPlanError extends Error {
  constructor(
    readonly code: 'BUILD_MODE_UNSUPPORTED' | 'PROVISIONING_APPROVAL_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'BuildPlanError';
  }
}

/** Mod -> Gradle task listesi. Bu tablo ürünün parçasıdır, girdi değildir. */
const MODE_TASKS: Readonly<Record<BuildMode, readonly string[]>> = {
  build: ['assemble'],
  unit_test: ['test'],
  integration_test: ['check'],
  clean_build: ['clean', 'assemble'],
};

/**
 * Her build'e eklenen sabit bayraklar.
 *
 * `--no-daemon`: daemon, konteyner/işlem ömründen uzun yaşayıp sahiplik
 * takibini bozar (SPIKE-WINDOWS-PROCESS-001'in açık sorusu).
 * `--stacktrace` yoktur: yığın izleri host yollarını rapora sızdırır.
 */
const BASE_ARGS: readonly string[] = ['--no-daemon', '--console=plain'];

export interface BuildPlan {
  readonly mode: BuildMode;
  readonly network: NetworkPolicy;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface BuildPlanOptions {
  readonly mode: BuildMode;
  readonly network?: NetworkPolicy;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  /** `repository-allowlist` yalnızca açık kullanıcı onayıyla kullanılabilir. */
  readonly provisioningApproved?: boolean;
}

export const DEFAULT_BUILD_TIMEOUT_MS = 300_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 5_242_880;

export function createBuildPlan(options: BuildPlanOptions): BuildPlan {
  const tasks = MODE_TASKS[options.mode];
  if (!tasks) {
    throw new BuildPlanError(
      'BUILD_MODE_UNSUPPORTED',
      `Desteklenmeyen build modu: "${String(options.mode)}". ` +
        `Seçenekler: ${Object.keys(MODE_TASKS).join(' | ')}. Serbest Gradle task verilemez.`,
    );
  }

  const network: NetworkPolicy = options.network ?? 'offline';

  if (network === 'repository-allowlist' && options.provisioningApproved !== true) {
    throw new BuildPlanError(
      'PROVISIONING_APPROVAL_REQUIRED',
      'Ağ erişimi gerektiren provisioning modu açık kullanıcı onayı ister. ' +
        'Onaylı provisioning workflow üzerinden çalıştırın; sonuç otomatik trusted olmaz.',
    );
  }

  const args = [...BASE_ARGS, ...tasks];
  if (network === 'offline') {
    // Reproducible mod: ağ kapalı. Bağımlılıklar doğrulanmış cache'ten gelir.
    args.push('--offline');
  }

  return {
    mode: options.mode,
    network,
    args,
    timeoutMs: options.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  };
}

/** Test ve dokümantasyon için mod listesi. */
export function supportedModes(): readonly BuildMode[] {
  return Object.keys(MODE_TASKS) as BuildMode[];
}
