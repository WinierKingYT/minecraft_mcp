/**
 * MCP Resources facade — docs/contracts/mcp.md "Resources" bölümünün
 * uygulaması.
 *
 *   minecraft://run/{run_id}/status
 *   minecraft://run/{run_id}/logs
 *   minecraft://run/{run_id}/events
 *   minecraft://run/{run_id}/report
 *   minecraft://run/{run_id}/evidence
 *   minecraft://operation/{operation_id}
 *   minecraft://project/{project_id}/manifest
 *   minecraft://runtime/{server_instance_id}/capabilities
 *   minecraft://artifact/{build_artifact_id}
 *
 * Kurallar (sözleşmeden):
 *   - MIME type zorunlu -> `application/json`
 *   - Byte limit zorunlu -> `RESOURCE_MAX_BYTES`; içerik kapakları (log/event
 *     sayısı) ve son çare kesme uygulanır
 *   - Redaction zorunlu -> depoda zaten uygulanır; bu katmanda çifte savunma
 *     olarak tekrar maskelenir
 *   - Silinen resource -> `ResourceNotFoundError` (RESOURCE_NOT_FOUND)
 *   - Raw host path dışarı verilmez -> artifact/project yüzeylerinde mutlak yol
 *     hiç üretilmez, redaction ile de maskelenir
 *
 * resources/list: SDK şablon list callback'lerini toplar (aggregate);
 * pagination, içerik düzeyinde byte limitiyle zorlanır.
 */

import { ResourceNotFoundError } from '@modelcontextprotocol/server';
import type {
  CacheHint,
  CompleteResourceTemplateCallback,
  ReadResourceTemplateCallback,
  Resource,
  ResourceMetadata,
} from '@modelcontextprotocol/server';
import type {
  BuildListResult,
  BuildResolveResult,
  OperationGetResult,
  OperationListResult,
  ProjectInspectResult,
  ProjectListResult,
  RunGetResult,
  RunListResult,
  RuntimeListResult,
} from '@mcpdev/contracts';
import type { SupervisorClient } from '../supervisor-client.js';
import { log } from '../logging.js';

export const RESOURCE_MIME = 'application/json';
/** Resource başına sert bayt sınırı. */
export const RESOURCE_MAX_BYTES = 512 * 1024;
/** Run içerik kapakları — JSON her zaman geçerli kalır. */
const MAX_RUN_LOGS = 1_000;
const MAX_RUN_EVENTS = 1_000;
const MAX_EVIDENCE_IDS = 2_000;

export interface ResourceFacadeOptions {
  readonly supervisor: () => Promise<SupervisorClient | null>;
}

/** SDK'ya kaydedilecek şablon tanımı. */
export interface ResourceTemplateSpec {
  readonly name: string;
  readonly uriTemplate: string;
  readonly metadata: ResourceMetadata & { cacheHint?: CacheHint };
  readonly list: (() => Promise<Resource[]>) | undefined;
  readonly complete: Record<string, CompleteResourceTemplateCallback>;
  readonly read: ReadResourceTemplateCallback;
}

/** URI değişkeni otomatik tamamlama callbacks — `Record` değil, tipli yüzey. */
export interface CompletionCallbacks {
  readonly runId: (value: string) => Promise<string[]>;
  readonly operationId: (value: string) => Promise<string[]>;
  readonly projectId: (value: string) => Promise<string[]>;
  readonly runtimeId: (value: string) => Promise<string[]>;
  readonly buildId: (value: string) => Promise<string[]>;
}

/**
 * Çifte savunma redaction'ı. Veri depoda zaten redacted; bu katman sızabilecek
 * her şeyi (mutlak host path dahil) bir kez daha maskeler.
 */
const RESOURCE_REDACTION_PATTERNS: ReadonlyArray<{ readonly field: string; readonly pattern: RegExp }> = [
  { field: 'authorization', pattern: /(authorization"?\s*[:=]\s*"?)(bearer\s+)?[A-Za-z0-9._~+/-]{8,}/gi },
  { field: 'token', pattern: /((?:bridge[_-]?)?token"?\s*[:=]\s*"?)[A-Za-z0-9._~+/-]{8,}/gi },
  { field: 'secret', pattern: /(secret"?\s*[:=]\s*"?)[^\s",}]{4,}/gi },
  { field: 'password', pattern: /(password"?\s*[:=]\s*"?)[^\s",}]{1,}/gi },
  { field: 'player.ip', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { field: 'host.path', pattern: /[A-Za-z]:[\\/][^\s"'<>|]*|\\\\[^\s"'<>|]*/g },
];

function redactResourceText(text: string): string {
  let out = text;
  for (const { pattern } of RESOURCE_REDACTION_PATTERNS) {
    out = out.replace(pattern, (_match, prefix: string | undefined) => `${prefix ?? ''}[REDACTED]`);
  }
  return out;
}

/** JSON -> redacted, byte-sınırlı TextResourceContents. */
function toTextResource(uri: string, data: unknown): { uri: string; mimeType: string; text: string } {
  const serialized = redactResourceText(JSON.stringify(data, null, 2));
  const encoded = Buffer.from(serialized, 'utf8');
  if (encoded.byteLength <= RESOURCE_MAX_BYTES) {
    return { uri, mimeType: RESOURCE_MIME, text: serialized };
  }
  // Son çare: bayt sınırına kes ve işaretle. İçerik kapakları normalde bu yola
  // düşülmesini engeller; kesilmiş JSON "geçersiz JSON" olabilir, açıkça işaretlenir.
  const cut = encoded.subarray(0, RESOURCE_MAX_BYTES).toString('utf8');
  return { uri, mimeType: RESOURCE_MIME, text: `${cut}\n...(byte_limit exceeded, truncated)` };
}

/** Şablon değişkeninden tek değeri çıkarır. */
function singleVar(variables: Readonly<Record<string, string | string[]>>, key: string): string {
  const value = variables[key];
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export class ResourceFacade {
  readonly #options: ResourceFacadeOptions;
  readonly #templates: readonly ResourceTemplateSpec[];

  constructor(options: ResourceFacadeOptions) {
    this.#options = options;
    this.#templates = this.#buildTemplates();
  }

  /** SDK'ya kaydedilecek tüm şablonlar. */
  listTemplates(): readonly ResourceTemplateSpec[] {
    return this.#templates;
  }

  async #client(): Promise<SupervisorClient> {
    const client = await this.#options.supervisor();
    if (!client) {
      throw new Error('SUPERVISOR_UNAVAILABLE: Supervisor çalışmıyor; resource okunamıyor.');
    }
    return client;
  }

  /** Bilinmeyen/retention-düşmüş kaynakları RESOURCE_NOT_FOUND'a eşler. */
  async #callOrNotFound<T>(uri: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code && /NOT_FOUND|UNKNOWN/.test(code)) {
        throw new ResourceNotFoundError(uri);
      }
      throw err;
    }
  }

  // ─── Listeleme yardımcıları ───────────────────────────────────────────

  /**
   * List callback'leri dayanıklıdır: supervisor kapalıysa boş liste döner ve
   * WARN loglanır (SDK resources/list, herhangi bir list callback fırlatırsa
   * tüm isteği düşürür — mcp-DXXb3Vv3.mjs). Şablonlar resources/templates/list
   * ile her zaman keşfedilebilir kalır; konkre içerik supervisor varken gelir.
   */
  async #safeList(label: string, fn: () => Promise<Resource[]>): Promise<Resource[]> {
    try {
      return await fn();
    } catch (err) {
      log('WARN', 'resource.list_unavailable', {
        collection: label,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async #runResources(): Promise<Resource[]> {
    const client = await this.#client();
    const { runs } = await client.call<RunListResult>('run.list', {});
    return runs.map((r) => ({
      uri: `minecraft://run/${r.runId}/status`,
      name: `run_${r.runId}_status`,
      title: `Run ${r.runId}`,
      description: `${r.status} · ${r.scenarioId ?? 'scenario yok'} · ${r.evidenceCount} kanıt`,
      mimeType: RESOURCE_MIME,
    }));
  }

  async #operationResources(): Promise<Resource[]> {
    const client = await this.#client();
    const { operations } = await client.call<OperationListResult>('operation.list', {});
    return operations.map((o) => ({
      uri: `minecraft://operation/${o.operationId}`,
      name: `operation_${o.operationId}`,
      title: `Operation ${o.operationId}`,
      description: `${o.operation} · ${o.status}`,
      mimeType: RESOURCE_MIME,
    }));
  }

  async #projectResources(): Promise<Resource[]> {
    const client = await this.#client();
    const { projects } = await client.call<ProjectListResult>('project.list', {});
    return projects.map((p) => ({
      uri: `minecraft://project/${p.projectId}/manifest`,
      name: `project_${p.projectId}_manifest`,
      title: `Project ${p.projectId}`,
      description: `trust: ${p.trustLevel} · backend: ${p.defaultBackend}`,
      mimeType: RESOURCE_MIME,
    }));
  }

  async #runtimeResources(): Promise<Resource[]> {
    const client = await this.#client();
    const { runtimes } = await client.call<RuntimeListResult>('runtime.list', {});
    return runtimes.map((r) => ({
      uri: `minecraft://runtime/${r.runtimeImageId}/capabilities`,
      name: `runtime_${r.runtimeImageId}_capabilities`,
      title: `Runtime ${r.runtimeImageId}`,
      description: `state: ${r.state}`,
      mimeType: RESOURCE_MIME,
    }));
  }

  async #artifactResources(): Promise<Resource[]> {
    const client = await this.#client();
    const { builds } = await client.call<BuildListResult>('build.list', {});
    return builds.map((b) => ({
      uri: `minecraft://artifact/${b.buildId}`,
      name: `artifact_${b.buildId}`,
      title: `Artifact ${b.buildId}`,
      description: `${b.projectId} · ${b.mode} · ${b.status}`,
      mimeType: RESOURCE_MIME,
    }));
  }

  // ─── Okuma yardımcıları ───────────────────────────────────────────────

  async #readRun(uri: URL, variables: Readonly<Record<string, string | string[]>>, suffix: 'status' | 'logs' | 'events' | 'report' | 'evidence') {
    const runId = singleVar(variables, 'run_id');
    if (!runId) {
      throw new ResourceNotFoundError(uri.toString());
    }
    const client = await this.#client();
    const run = await this.#callOrNotFound<RunGetResult>(
      uri.toString(),
      () => client.call('run.get', { runId }),
    );

    switch (suffix) {
      case 'status':
        return toTextResource(uri.toString(), {
          run_id: run.runId,
          status: run.status,
          scenario_id: run.scenarioId,
          project_id: run.projectId,
          started_at: run.startedAt,
          completed_at: run.completedAt,
          duration_ms: run.durationMs,
          summary: run.summary,
        });
      case 'logs':
        return toTextResource(uri.toString(), {
          run_id: run.runId,
          logs: run.logs.slice(0, MAX_RUN_LOGS),
          truncated: run.logs.length > MAX_RUN_LOGS,
        });
      case 'events':
        return toTextResource(uri.toString(), {
          run_id: run.runId,
          events: run.events.slice(0, MAX_RUN_EVENTS),
          truncated: run.events.length > MAX_RUN_EVENTS,
        });
      case 'evidence':
        return toTextResource(uri.toString(), {
          run_id: run.runId,
          evidence_ids: run.evidenceIds.slice(0, MAX_EVIDENCE_IDS),
          truncated: run.evidenceIds.length > MAX_EVIDENCE_IDS,
        });
      case 'report':
        return toTextResource(uri.toString(), {
          schema: 'run-report-v1',
          run_id: run.runId,
          status: run.status,
          generated_at: run.completedAt,
          provenance: {
            scenario_id: run.scenarioId,
            scenario_path: run.scenarioPath,
            project_id: run.projectId,
            runtime_image_id: run.runtimeImageId,
            bridge_boot_id: run.bridgeBootId,
          },
          summary: run.summary,
          scenarios: [
            {
              scenario_id: run.scenarioId,
              scenario_path: run.scenarioPath,
              status: run.status,
              passed: run.summary.passed,
              failed: run.summary.failed,
              skipped: run.summary.skipped,
              duration_ms: run.durationMs,
              evidence_ids: run.evidenceIds,
            },
          ],
        });
    }
  }

  async #readOperation(uri: URL, variables: Readonly<Record<string, string | string[]>>) {
    const operationId = singleVar(variables, 'operation_id');
    if (!operationId) {
      throw new ResourceNotFoundError(uri.toString());
    }
    const client = await this.#client();
    const operation = await this.#callOrNotFound<OperationGetResult>(
      uri.toString(),
      () => client.call('operation.get', { operationId }),
    );
    return toTextResource(uri.toString(), operation);
  }

  async #readProjectManifest(uri: URL, variables: Readonly<Record<string, string | string[]>>) {
    const projectId = singleVar(variables, 'project_id');
    if (!projectId) {
      throw new ResourceNotFoundError(uri.toString());
    }
    const client = await this.#client();
    const inspect = await this.#callOrNotFound<ProjectInspectResult>(
      uri.toString(),
      () => client.call('project.inspect', { projectId }),
    );
    // Raw host path (rootPath) bilinçli olarak dışarı verilmez (mcp.md).
    return toTextResource(uri.toString(), {
      project_id: inspect.projectId,
      trust_level: inspect.trustLevel,
      gradle_wrapper: inspect.gradleWrapper,
      plugin_metadata: inspect.pluginMetadata,
      test_contract: inspect.testContract,
    });
  }

  async #readRuntimeCapabilities(uri: URL, variables: Readonly<Record<string, string | string[]>>) {
    const serverInstanceId = singleVar(variables, 'server_instance_id');
    if (!serverInstanceId) {
      throw new ResourceNotFoundError(uri.toString());
    }
    const client = await this.#client();
    const summary = await this.#callOrNotFound(
      uri.toString(),
      () => client.call('runtime.get', { runtimeImageId: serverInstanceId }),
    );
    return toTextResource(uri.toString(), summary);
  }

  async #readArtifact(uri: URL, variables: Readonly<Record<string, string | string[]>>) {
    const buildId = singleVar(variables, 'build_artifact_id');
    if (!buildId) {
      throw new ResourceNotFoundError(uri.toString());
    }
    const client = await this.#client();
    const resolved = await this.#callOrNotFound<BuildResolveResult>(
      uri.toString(),
      () => client.call('build.resolve', { buildId }),
    );
    return toTextResource(uri.toString(), resolved);
  }

  // ─── Şablon inşası ────────────────────────────────────────────────────

  #buildTemplates(): readonly ResourceTemplateSpec[] {
    const cacheHint: CacheHint = { ttlMs: 5_000, cacheScope: 'private' };
    const read = this.#readRun.bind(this);
    const completions = this.#completions();

    const runSuffixes = ['status', 'logs', 'events', 'report', 'evidence'] as const;
    const runTemplates: ResourceTemplateSpec[] = runSuffixes.map((suffix) => ({
      name: `run_${suffix}`,
      uriTemplate: `minecraft://run/{run_id}/${suffix}`,
      metadata: {
        title: `Run ${suffix}`,
        description: `Bir scenario run'ının ${suffix} verisi (runId tabanlı).`,
        mimeType: RESOURCE_MIME,
        cacheHint,
      },
        list: () => this.#safeList('run', () => this.#runResources()),
      complete: { run_id: completions.runId },
      read: (uri, variables) => this.#toResult(read(uri, variables, suffix)),
    }));

    return [
      ...runTemplates,
      {
        name: 'operation',
        uriTemplate: 'minecraft://operation/{operation_id}',
        metadata: {
          title: 'Operation',
          description: 'bridge.query üzerinden geçen bir işlemin kaydı.',
          mimeType: RESOURCE_MIME,
          cacheHint,
        },
        list: () => this.#safeList('operation', () => this.#operationResources()),
        complete: { operation_id: completions.operationId },
        read: (uri, variables) => this.#toResult(this.#readOperation(uri, variables)),
      },
      {
        name: 'project_manifest',
        uriTemplate: 'minecraft://project/{project_id}/manifest',
        metadata: {
          title: 'Project manifest',
          description: 'Proje güven profili ve plugin metadata (host path içermez).',
          mimeType: RESOURCE_MIME,
          cacheHint,
        },
        list: () => this.#safeList('project', () => this.#projectResources()),
        complete: { project_id: completions.projectId },
        read: (uri, variables) => this.#toResult(this.#readProjectManifest(uri, variables)),
      },
      {
        name: 'runtime_capabilities',
        uriTemplate: 'minecraft://runtime/{server_instance_id}/capabilities',
        metadata: {
          title: 'Runtime capabilities',
          description: 'Runtime durum makinesi ve bridge bağlantı özeti.',
          mimeType: RESOURCE_MIME,
          cacheHint,
        },
        list: () => this.#safeList('runtime', () => this.#runtimeResources()),
        complete: { server_instance_id: completions.runtimeId },
        read: (uri, variables) => this.#toResult(this.#readRuntimeCapabilities(uri, variables)),
      },
      {
        name: 'artifact',
        uriTemplate: 'minecraft://artifact/{build_artifact_id}',
        metadata: {
          title: 'Build artifact',
          description: 'Build artifact metadata (mutlak host path içermez).',
          mimeType: RESOURCE_MIME,
          cacheHint,
        },
        list: () => this.#safeList('artifact', () => this.#artifactResources()),
        complete: { build_artifact_id: completions.buildId },
        read: (uri, variables) => this.#toResult(this.#readArtifact(uri, variables)),
      },
    ];
  }

  /** Okuma sonucunu `ReadResourceResult` biçimine sarar. */
  #toResult(promise: Promise<{ uri: string; mimeType: string; text: string }>) {
    return promise.then((contents) => ({ contents: [contents] }));
  }

  #completions(): CompletionCallbacks {
    return {
      runId: async (value: string) => {
        try {
          const client = await this.#client();
          const { runs } = await client.call<RunListResult>('run.list', {});
          return runs.map((r) => r.runId).filter((id) => id.startsWith(value)).slice(0, 20);
        } catch (err) {
          log('WARN', 'resource.complete_unavailable', { variable: 'run_id', error: err instanceof Error ? err.message : String(err) });
          return [];
        }
      },
      operationId: async (value: string) => {
        try {
          const client = await this.#client();
          const { operations } = await client.call<OperationListResult>('operation.list', {});
          return operations.map((o) => o.operationId).filter((id) => id.startsWith(value)).slice(0, 20);
        } catch (err) {
          log('WARN', 'resource.complete_unavailable', { variable: 'operation_id', error: err instanceof Error ? err.message : String(err) });
          return [];
        }
      },
      projectId: async (value: string) => {
        try {
          const client = await this.#client();
          const { projects } = await client.call<ProjectListResult>('project.list', {});
          return projects.map((p) => p.projectId).filter((id) => id.startsWith(value)).slice(0, 20);
        } catch (err) {
          log('WARN', 'resource.complete_unavailable', { variable: 'project_id', error: err instanceof Error ? err.message : String(err) });
          return [];
        }
      },
      runtimeId: async (value: string) => {
        try {
          const client = await this.#client();
          const { runtimes } = await client.call<RuntimeListResult>('runtime.list', {});
          return runtimes.map((r) => r.runtimeImageId).filter((id) => id.startsWith(value)).slice(0, 20);
        } catch (err) {
          log('WARN', 'resource.complete_unavailable', { variable: 'server_instance_id', error: err instanceof Error ? err.message : String(err) });
          return [];
        }
      },
      buildId: async (value: string) => {
        try {
          const client = await this.#client();
          const { builds } = await client.call<BuildListResult>('build.list', {});
          return builds.map((b) => b.buildId).filter((id) => id.startsWith(value)).slice(0, 20);
        } catch (err) {
          log('WARN', 'resource.complete_unavailable', { variable: 'build_artifact_id', error: err instanceof Error ? err.message : String(err) });
          return [];
        }
      },
    };
  }
}
