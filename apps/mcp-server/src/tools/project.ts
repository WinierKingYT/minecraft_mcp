/**
 * M1 + P0-4k tool'ları: project_list, project_inspect, project_validate.
 *
 * Proje kaydı launcher config/CLI yüzeyindendir (main.ts --project-id/
 * --project-root; P0-7 serve); agent yüzeyinde register tool'u yoktur
 * (R3 — ADR-0007: R3/R4 hiçbir profilde agent yüzeyine çıkmaz).
 *
 * Supervisor IPC üzerinden proje listesi, metadata ve Gradle supply-chain
 * doğrulamasını sağlar.
 */

import { toolSuccess, toolError, type ToolDefinition, type ToolHandler } from './facade.js';
import type { SupervisorClient } from '../supervisor-client.js';
import type {
  ProjectInspectResult,
  ProjectValidateResult,
  ProjectListResult,
} from '@mcpdev/contracts';

const TOOL_RESULT_SCHEMA_REF = {
  $ref: 'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json',
} as const;

export interface ProjectToolsInfo {
  readonly supervisor: () => Promise<SupervisorClient | null>;
}

export function createProjectTools(info: ProjectToolsInfo): Array<[ToolDefinition, ToolHandler]> {
  const projectList: [ToolDefinition, ToolHandler] = [
    {
      name: 'project_list',
      title: 'Project list',
      description: 'Trust store\'daki kayıtlı projeleri listeler; project_id verilirse yalnızca o projeyi döndürür.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project_id: { type: 'string', description: 'İsteğe bağlı proje kimliği filtresi' },
        },
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const projectId = args['project_id'];
      if (projectId !== undefined && typeof projectId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'project_id' });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<ProjectListResult>('project.list', {
          ...(projectId !== undefined ? { projectId } : {}),
        });

        return toolSuccess(ctx.correlationId, {
          projects: result.projects.map((project) => ({
            project_id: project.projectId,
            trust_level: project.trustLevel,
            allowed_backends: project.allowedBackends,
            default_backend: project.defaultBackend,
          })),
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'PROJECT_NOT_REGISTERED') as never, {
          ...(projectId !== undefined ? { project_id: projectId } : {}),
          message: error.message ?? String(err),
        });
      }
    },
  ];

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
      description: 'Gradle veya Maven wrapper bütünlüğünü, dependency lock/verification durumunu ve Java/Paper/API uyumluluğunu doğrular; build sistemi wrapper varlığına göre explicit seçilir.',
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
          build_system: result.buildSystem,
          gradle_version: result.gradleVersion,
          maven_version: result.mavenVersion,
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

  return [projectList, projectInspect, projectValidate];
}
