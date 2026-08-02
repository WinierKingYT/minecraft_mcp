/**
 * M1 tool'ları: project_inspect ve project_validate.
 *
 * Supervisor IPC üzerinden proje metadata ve Gradle supply-chain
 * doğrulamasını sağlar.
 */

import { toolSuccess, toolError, type ToolDefinition, type ToolHandler } from './facade.js';
import type { SupervisorClient } from '../supervisor-client.js';
import type { ProjectInspectResult, ProjectValidateResult } from '@mcpdev/contracts';

const TOOL_RESULT_SCHEMA_REF = {
  $ref: 'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json',
} as const;

export interface ProjectToolsInfo {
  readonly supervisor: () => Promise<SupervisorClient | null>;
}

export function createProjectTools(info: ProjectToolsInfo): Array<[ToolDefinition, ToolHandler]> {
  const projectInspect: [ToolDefinition, ToolHandler] = [
    {
      name: 'project_inspect',
      title: 'Project inspect',
      description: 'Kayıtlı projenin Gradle wrapper, plugin.yml ve test contract durumunu keşfeder.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project_id: { type: 'string', description: 'Proje kimliği' },
        },
        required: ['project_id'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const projectId = args['project_id'];
      if (typeof projectId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'project_id' });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<ProjectInspectResult>('project.inspect', { projectId });

        return toolSuccess(ctx.correlationId, {
          project_id: result.projectId,
          root_path: result.rootPath,
          trust_level: result.trustLevel,
          gradle_wrapper: result.gradleWrapper,
          plugin_metadata: result.pluginMetadata,
          test_contract: result.testContract,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'PROJECT_NOT_REGISTERED') as never, {
          project_id: projectId,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  const projectValidate: [ToolDefinition, ToolHandler] = [
    {
      name: 'project_validate',
      title: 'Project validate',
      description: 'Gradle wrapper bütünlüğünü, dependency lock/verification durumunu ve Java/Paper/API uyumluluğunu doğrular.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project_id: { type: 'string', description: 'Proje kimliği' },
        },
        required: ['project_id'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const projectId = args['project_id'];
      if (typeof projectId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'project_id' });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<ProjectValidateResult>('project.validate', { projectId });

        return toolSuccess(ctx.correlationId, {
          project_id: result.projectId,
          findings: result.findings,
          gradle_version: result.gradleVersion,
          java_major: result.javaMajor,
          distribution_sha256_valid: result.distributionSha256Valid,
          lock_file_present: result.lockFilePresent,
          verification_metadata_present: result.verificationMetadataPresent,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'PROJECT_NOT_REGISTERED') as never, {
          project_id: projectId,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  return [projectInspect, projectValidate];
}
