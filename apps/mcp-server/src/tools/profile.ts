/**
 * V1.1 tool'ları: profile_list, profile_get.
 *
 * Mevcut uyumluluk profillerini listeler ve detaylarını döndürür.
 */

import { toolSuccess, toolError, type ToolDefinition, type ToolHandler } from './facade.js';
import type { SupervisorClient } from '../supervisor-client.js';
import type { ProfileListResult, ProfileGetResult } from '@mcpdev/contracts';

const TOOL_RESULT_SCHEMA_REF = {
  $ref: 'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json',
} as const;

export interface ProfileToolsInfo {
  readonly supervisor: () => Promise<SupervisorClient | null>;
}

export function createProfileTools(info: ProfileToolsInfo): Array<[ToolDefinition, ToolHandler]> {
  const profileList: [ToolDefinition, ToolHandler] = [
    {
      name: 'profile_list',
      title: 'Profile list',
      description: "Mevcut uyumluluk profillerinin listesini döndürür.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (_args, ctx) => {
      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<ProfileListResult>('profile.list', {});
        return toolSuccess(ctx.correlationId, {
          profiles: result.profiles.map(p => ({
            id: p.id,
            status: p.status,
            minecraft_version: p.minecraftVersion,
            paper_build: p.paperBuild,
            verification_status: p.verificationStatus,
          })),
          active_profile_id: result.activeProfileId,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'SUPERVISOR_INTERNAL_ERROR') as never, {
          message: error.message ?? String(err),
        });
      }
    },
  ];

  const profileGet: [ToolDefinition, ToolHandler] = [
    {
      name: 'profile_get',
      title: 'Profile get',
      description: "Belirtilen uyumluluk profilinin detaylarını döndürür.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          profile_id: { type: 'string', description: 'Profil kimliği (örn: paper-26.2-build-84-v1)' },
        },
        required: ['profile_id'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const profileId = args['profile_id'];
      if (typeof profileId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'profile_id' });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<ProfileGetResult>('profile.get', { profileId });
        return toolSuccess(ctx.correlationId, {
          id: result.id,
          status: result.status,
          minecraft_version: result.minecraftVersion,
          paper_build: result.paperBuild,
          verification_status: result.verificationStatus,
          java_version: result.javaVersion,
          node_version: result.nodeVersion,
          gradle_version: result.gradleVersion,
          maven_version: result.mavenVersion,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'CONFIG_INVALID') as never, {
          profile_id: profileId,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  return [profileList, profileGet];
}