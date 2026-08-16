/**
 * Uyumluluk profili yükleyici.
 *
 * compatibility/README.md kural 1: profil normatif kaynaktır; kod içine gömülü
 * sürüm sabiti bulunamaz. Her bileşen profili buradan okur.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface CompatibilityProfile {
  readonly id: string;
  readonly status?: string;
  readonly verification: {
    readonly status: 'unverified' | 'partially_verified' | 'verified';
    readonly verified_fields?: readonly string[];
    readonly pending_fields?: readonly string[];
  };
  readonly minecraft: { readonly version: string };
  readonly paper: {
    readonly channel: string;
    readonly build: number;
    readonly api_coordinate: string;
    readonly api_version: string;
    readonly jar_sha256: string | null;
    readonly jar_filename?: string;
    readonly user_agent_required?: boolean;
    readonly hardcoded_download_url_allowed: boolean;
  };
  readonly java: { readonly runtime_major: number; readonly toolchain_major: number };
  readonly node: { readonly version: string };
  readonly gradle: {
    readonly wrapper_version: string;
    readonly distribution_sha256: string | null;
    readonly wrapper_jar_sha256?: string;
  };
  readonly maven?: {
    /** Apache Maven dağıtım sürümü (build runtime). */
    readonly version: string;
    readonly distribution: {
      readonly url?: string;
      /** bin.zip SHA-256; dağıtım doğrulaması bu değere karşı yapılır. */
      readonly sha256: string | null;
      readonly host_allowlist?: readonly string[];
    };
    /** Maven Wrapper aracı (launcher) — dağıtım sürümünden ayrı sürüm hattı. */
    readonly wrapper: {
      readonly version: string;
      readonly jar_sha256?: string;
    };
  };
  readonly mcp: { readonly protocol_version: string; readonly transport: string };
  readonly protocols: Readonly<Record<string, number>>;
}

export interface ProfileSummary {
  readonly id: string;
  readonly status: string;
  readonly minecraftVersion: string;
  readonly paperBuild: number;
  readonly verificationStatus: string;
}

export class ProfileError extends Error {
  constructor(
    readonly code: 'CONFIG_INVALID' | 'COMPATIBILITY_PROFILE_UNVERIFIED',
    message: string,
  ) {
    super(message);
    this.name = 'ProfileError';
  }
}

export function loadCompatibilityProfile(repoRoot: string, profileId: string): CompatibilityProfile {
  const file = join(repoRoot, 'compatibility', `${profileId}.yaml`);
  if (!existsSync(file)) {
    throw new ProfileError('CONFIG_INVALID', `Uyumluluk profili bulunamadı: ${file}`);
  }

  const profile = parseYaml(readFileSync(file, 'utf8')) as CompatibilityProfile;

  if (profile.id !== profileId) {
    throw new ProfileError('CONFIG_INVALID', `Profil id uyuşmuyor: dosya ${profileId}, içerik ${profile.id}`);
  }

  return profile;
}

export function listCompatibilityProfiles(repoRoot: string): ProfileSummary[] {
  const compatDir = join(repoRoot, 'compatibility');
  if (!existsSync(compatDir)) {
    return [];
  }

  const files = readdirSync(compatDir).filter((f) => f.endsWith('.yaml') && f !== 'README.md');
  const profiles: ProfileSummary[] = [];

  for (const file of files) {
    try {
      const profileId = file.replace('.yaml', '');
      const profile = loadCompatibilityProfile(repoRoot, profileId);
      profiles.push({
        id: profile.id,
        status: profile.status ?? 'unknown',
        minecraftVersion: profile.minecraft.version,
        paperBuild: profile.paper.build,
        verificationStatus: profile.verification?.status ?? 'unverified',
      });
    } catch {
      // Skip invalid profiles
    }
  }

  return profiles;
}

/**
 * Release profilinde doğrulanmamış profille çalışmayı engeller.
 *
 * Prototype kanalında `partially_verified` kabul edilir; `unverified` hiçbir
 * kanalda kabul edilmez — doğrulanmamış bir sürüm kombinasyonu üzerine runtime
 * kurmak, tüm kanıt zincirini anlamsız kılar.
 */
export function assertProfileUsable(
  profile: CompatibilityProfile,
  channel: 'prototype' | 'release',
): void {
  const status = profile.verification?.status ?? 'unverified';

  if (status === 'unverified') {
    throw new ProfileError(
      'COMPATIBILITY_PROFILE_UNVERIFIED',
      `Profil "${profile.id}" doğrulanmamış. pnpm run verify:compatibility çalıştırın.`,
    );
  }

  if (channel === 'release' && status !== 'verified') {
    throw new ProfileError(
      'COMPATIBILITY_PROFILE_UNVERIFIED',
      `Release build "${status}" durumundaki profille üretilemez. ` +
        `Bekleyen alanlar: ${(profile.verification.pending_fields ?? []).join(', ') || '(bilinmiyor)'}`,
    );
  }
}
