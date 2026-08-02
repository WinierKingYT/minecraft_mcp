/**
 * M0 tool'ları: system_health ve system_capabilities.
 *
 * Bunlar Supervisor veya Bridge gerektirmeden çalışabilen tek tool'lardır;
 * bu yüzden ilk uygulanan tool'lar bunlardır (M0 vertical slice).
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { TOOL_PROFILES } from '@mcpdev/generated-types';
import type { SupervisorHealthResult } from '@mcpdev/contracts';
import { toolSuccess, type ToolDefinition, type ToolHandler } from './facade.js';
import type { SupervisorClient } from '../supervisor-client.js';

const TOOL_RESULT_SCHEMA_REF = {
  $ref: 'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json',
} as const;

const NO_ARGS = { type: 'object', additionalProperties: false, properties: {} } as const;

export interface ServerRuntimeInfo {
  readonly serverVersion: string;
  readonly compatibilityProfileId: string;
  readonly compatibilityProfilePath: string;
  /**
   * Supervisor'a bağlanmayı sağlayan fabrika.
   *
   * ADR-0003: MCP Server Supervisor'ı doğurmaz, ona bağlanır. Bağlanamamak bir
   * hata durumudur ve sağlık raporunda GİZLENMEZ — "ok" demek, olmayan bir
   * bileşeni var göstermek olurdu.
   */
  readonly supervisor?: () => Promise<SupervisorClient | null>;
}

interface CompatibilityProfileShape {
  readonly id?: string;
  readonly verification?: {
    readonly status?: string;
    readonly pending_fields?: readonly string[];
    readonly verified_fields?: readonly string[];
  };
  readonly mcp?: { readonly protocol_version?: string; readonly transport?: string };
  readonly paper?: { readonly build?: number };
  readonly minecraft?: { readonly version?: string };
  readonly java?: { readonly runtime_major?: number };
  readonly protocols?: Readonly<Record<string, number>>;
}

function loadProfile(path: string): CompatibilityProfileShape | null {
  if (!existsSync(path)) return null;
  try {
    return parseYaml(readFileSync(path, 'utf8')) as CompatibilityProfileShape;
  } catch {
    return null;
  }
}

/**
 * Profil doğrulanmamışsa bu uyarı HER yanıtta taşınır. Sessiz kalmak,
 * doğrulanmamış bir sürüm kombinasyonunu doğrulanmış gibi sunmak olurdu
 * (DOC-GATE-02).
 */
function profileWarnings(profile: CompatibilityProfileShape | null): string[] {
  if (!profile) return ['Uyumluluk profili okunamadı.'];
  const status = profile.verification?.status ?? 'unknown';
  if (status === 'verified') return [];
  const pending = profile.verification?.pending_fields?.length ?? 0;
  return [
    `Uyumluluk profili "${status}" durumunda (${pending} alan doğrulanmayı bekliyor). ` +
      'Ürün prototype kanalındadır; release build üretilemez.',
  ];
}

export function createSystemTools(info: ServerRuntimeInfo): Array<[ToolDefinition, ToolHandler]> {
  const systemHealth: [ToolDefinition, ToolHandler] = [
    {
      name: 'system_health',
      title: 'System health',
      description: 'MCP Server, Supervisor ve yapılandırma sağlığını raporlar.',
      inputSchema: NO_ARGS,
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (_args, ctx) => {
      const profile = loadProfile(info.compatibilityProfilePath);
      const warnings = profileWarnings(profile);

      let supervisor: Record<string, unknown> = { status: 'not_connected' };
      try {
        const client = info.supervisor ? await info.supervisor() : null;
        if (client) {
          const health = await client.call<SupervisorHealthResult>('supervisor.health', {});
          supervisor = {
            status: health.status,
            version: health.version,
            pid: health.pid,
            uptime_ms: health.uptimeMs,
            active_runtimes: health.runtimeCount,
            java_major: health.javaMajor,
          };
          if (health.javaMajor === null) {
            warnings.push('Supervisor uygun bir Java kurulumu bulamadı; runtime başlatılamaz.');
          }
        } else {
          warnings.push('Run Supervisor çalışmıyor; build ve runtime araçları kullanılamaz.');
        }
      } catch (err) {
        // Bağlanamama "ok" olarak raporlanmaz.
        supervisor = {
          status: 'unavailable',
          error: err instanceof Error ? err.message : String(err),
        };
        warnings.push('Run Supervisor\'a ulaşılamadı; build ve runtime araçları kullanılamaz.');
      }

      return toolSuccess(
        ctx.correlationId,
        {
          mcp_server: {
            version: info.serverVersion,
            status: 'ok',
            transport: 'stdio',
            protocol_mode: 'stateless',
            channel: 'prototype',
          },
          supervisor,
          compatibility_profile: {
            id: profile?.id ?? info.compatibilityProfileId,
            verification_status: profile?.verification?.status ?? 'unknown',
            pending_fields: profile?.verification?.pending_fields ?? [],
          },
          node: { version: process.versions.node },
        },
        warnings,
      );
    },
  ];

  const systemCapabilities: [ToolDefinition, ToolHandler] = [
    {
      name: 'system_capabilities',
      title: 'System capabilities',
      description: 'Aktif tool profilini, uyumluluk profilini ve protokol sürümlerini bildirir.',
      inputSchema: NO_ARGS,
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (_args, ctx) => {
      const profile = loadProfile(info.compatibilityProfilePath);
      return toolSuccess(
        ctx.correlationId,
        {
          tool_profile: ctx.profile,
          tools: TOOL_PROFILES[ctx.profile],
          compatibility_profile: {
            id: profile?.id ?? info.compatibilityProfileId,
            verification_status: profile?.verification?.status ?? 'unknown',
            minecraft_version: profile?.minecraft?.version ?? null,
            paper_build: profile?.paper?.build ?? null,
            java_runtime_major: profile?.java?.runtime_major ?? null,
          },
          protocols: {
            mcp: profile?.mcp?.protocol_version ?? null,
            transport: profile?.mcp?.transport ?? 'stdio',
            ...(profile?.protocols ?? {}),
          },
          // ADR-0007 / KPI-11 — bu alanlar bilinçli olarak yanıtın parçasıdır.
          known_limitations: [
            'trusted-local backend host izolasyonu sağlamaz ve sandbox değildir.',
            'Bridge auth, aynı Paper JVM içindeki aktif kötü niyetli hedef plugin\'e karşı güvenlik sınırı değildir.',
            'Agent-facing destructive tool bulunmamaktadır.',
          ],
        },
        profileWarnings(profile),
      );
    },
  ];

  return [systemHealth, systemCapabilities];
}

export function defaultProfilePath(root: string, profileId: string): string {
  return join(root, 'compatibility', `${profileId}.yaml`);
}
