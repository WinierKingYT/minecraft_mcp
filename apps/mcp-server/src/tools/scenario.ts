/**
 * M2A tool'ları: scenario_validate ve scenario_run.
 *
 * Scenario DSL dosyalarını doğrular ve çalıştırır.
 */

import { readFileSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { toolSuccess, toolError, type ToolDefinition, type ToolHandler } from './facade.js';
import type { SupervisorClient } from '../supervisor-client.js';
import type { ScenarioRunResult } from '@mcpdev/contracts';

const TOOL_RESULT_SCHEMA_REF = {
  $ref: 'https://minecraft-plugin-dev-mcp/schemas/common/tool-result.schema.json',
} as const;

const DSL_STEP_ALLOWLIST = [
  'test_actor.create',
  'test_actor.disconnect_all',
  'player.break_block',
  'player.move',
  'player.look',
  'player.chat',
  'plugin.command',
  'world.set_block',
  'world.set_chunk_ticket',
  'assert.block',
  'assert.player_state',
  'assert.player_message',
  'assert.event',
  'assert.no_log',
  'assert.plugin_enabled',
  'assert.server_state',
  'wait',
] as const;

/**
 * Step_argüman şemaları.
 * Agent'ların hangi argümanları kullanabileceğini gösterir.
 */
const STEP_SCHEMAS: Readonly<Record<string, {
  readonly description: string;
  readonly args: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly required: boolean;
    readonly description: string;
  }>;
  readonly capability: string;
  readonly milestone: string;
}>> = {
  'test_actor.create': {
    description: 'Yeni bir test actor oluşturur.',
    capability: 'test_actor.protocol',
    milestone: 'M2B',
    args: [
      { name: 'id', type: 'string', required: true, description: 'Actor benzersiz tanımlayıcısı' },
      { name: 'position', type: 'Position', required: false, description: 'Başlangıç konumu' },
    ],
  },
  'test_actor.disconnect_all': {
    description: 'Tum test actorlari baglantidan keser.',
    capability: 'actor.disconnect',
    milestone: 'M2B',
    args: [],
  },
  'player.break_block': {
    description: 'Oyuncunun bir bloğu kırmasını sağlar.',
    capability: 'player.break_block',
    milestone: 'M2B',
    args: [
      { name: 'actor', type: 'string', required: true, description: 'Actor tanımlayıcısı' },
      { name: 'position', type: 'Position', required: true, description: 'Blok konumu' },
    ],
  },
  'player.move': {
    description: 'Oyuncunun belirli bir konuma hareket etmesini sağlar.',
    capability: 'player.state.read',
    milestone: 'M2B',
    args: [
      { name: 'actor', type: 'string', required: true, description: 'Actor tanımlayıcısı' },
      { name: 'position', type: 'Position', required: true, description: 'Hedef konum' },
    ],
  },
  'player.look': {
    description: 'Oyuncunun belirli bir yöne bakmasını sağlar.',
    capability: 'player.state.read',
    milestone: 'M2B',
    args: [
      { name: 'actor', type: 'string', required: true, description: 'Actor tanımlayıcısı' },
      { name: 'direction', type: 'string', required: true, description: 'Yön (north, south, east, west, up, down)' },
    ],
  },
  'player.chat': {
    description: 'Oyuncunun sohbet mesajı göndermesini sağlar.',
    capability: 'actor.message.read',
    milestone: 'M2B',
    args: [
      { name: 'actor', type: 'string', required: true, description: 'Actor tanımlayıcısı' },
      { name: 'message', type: 'string', required: true, description: 'Sohbet mesajı' },
    ],
  },
  'plugin.command': {
    description: 'Plugin komutunu çalıştırır.',
    capability: 'plugin.command.typed',
    milestone: 'M2B',
    args: [
      { name: 'actor', type: 'string', required: true, description: 'Komutu çalıştıran actor' },
      { name: 'command_id', type: 'string', required: true, description: 'Komut tanımlayıcısı' },
      { name: 'arguments', type: 'Record<string, unknown>', required: false, description: 'Komut argümanları' },
    ],
  },
  'world.set_block': {
    description: 'Belirli bir konuma blok yerleştirir.',
    capability: 'world.block.write',
    milestone: 'M2A',
    args: [
      { name: 'position', type: 'Position', required: true, description: 'Blok konumu' },
      { name: 'material', type: 'string', required: true, description: 'Blok malzemesi (örn: minecraft:stone)' },
    ],
  },
  'world.set_chunk_ticket': {
    description: 'Bir bölgeye chunk ticket koyar; ticket chunk\'ların oyuncusuz da yüklü kalmasını sağlar.',
    capability: 'world.chunk.ticket',
    milestone: 'M2A',
    args: [
      { name: 'position', type: 'Position', required: true, description: 'Ticket merkezi (world_key, x, z kullanılır)' },
      { name: 'radius', type: 'number', required: false, description: 'Yarıçap (1-4; varsayılan 1)' },
    ],
  },
  'assert.block': {
    description: 'Belirli bir konumdaki bloğun durumunu doğrular.',
    capability: 'world.block.read',
    milestone: 'M0',
    args: [
      { name: 'position', type: 'Position', required: true, description: 'Blok konumu' },
      { name: 'material', type: 'string', required: false, description: 'Beklenen malzeme' },
      { name: 'within', type: 'string', required: false, description: 'Timeout süresi (örn: 5s, 500ms)' },
    ],
  },
  'assert.player_state': {
    description: 'Oyuncu durumunu doğrular.',
    capability: 'player.state.read',
    milestone: 'M0',
    args: [
      { name: 'actor', type: 'string', required: false, description: 'Oyuncu tanımlayıcısı' },
      { name: 'gamemode', type: 'string', required: false, description: 'Beklenen gamemode' },
      { name: 'health', type: 'number', required: false, description: 'Beklenen minimum health' },
      { name: 'within', type: 'string', required: false, description: 'Timeout süresi' },
    ],
  },
  'assert.player_message': {
    description: 'Oyuncu mesajını doğrular.',
    capability: 'actor.message.read',
    milestone: 'M2B',
    args: [
      { name: 'actor', type: 'string', required: true, description: 'Oyuncu tanımlayıcısı' },
      { name: 'message_key', type: 'string', required: true, description: 'Mesaj anahtarı' },
      { name: 'within', type: 'string', required: false, description: 'Timeout süresi' },
    ],
  },
  'assert.event': {
    description: 'Oluşan bir olayı doğrular.',
    capability: 'events.read',
    milestone: 'M0',
    args: [
      { name: 'type', type: 'string', required: true, description: 'Olay türü (örn: plugin.enabled, block.break)' },
      { name: 'actor', type: 'string', required: false, description: 'Olayı oluşturan actor' },
      { name: 'cancelled', type: 'boolean', required: false, description: 'Olay iptal edildi mi?' },
      { name: 'within', type: 'string', required: false, description: 'Timeout süresi' },
    ],
  },
  'assert.no_log': {
    description: 'Belirli bir seviyede log olup olmadığını doğrular.',
    capability: 'logs.read',
    milestone: 'M0',
    args: [
      { name: 'level_at_least', type: 'string', required: false, description: 'Minimum log seviyesi (TRACE, DEBUG, INFO, WARN, ERROR, FATAL)' },
      { name: 'within', type: 'string', required: false, description: 'Timeout süresi' },
    ],
  },
  'assert.plugin_enabled': {
    description: 'Plugin\'in etkin olup olmadığını doğrular.',
    capability: 'plugin.list',
    milestone: 'M0',
    args: [
      { name: 'name', type: 'string', required: false, description: 'Plugin adı (belirtilmezse herhangi bir plugin)' },
      { name: 'within', type: 'string', required: false, description: 'Timeout süresi' },
    ],
  },
  'assert.server_state': {
    description: 'Sunucu durumunu doğrular.',
    capability: 'server.state.read',
    milestone: 'M0',
    args: [
      { name: 'motd', type: 'string', required: false, description: 'Beklenen MOTD' },
      { name: 'max_players', type: 'number', required: false, description: 'Beklenen maks oyuncu sayısı' },
      { name: 'within', type: 'string', required: false, description: 'Timeout süresi' },
    ],
  },
  'wait': {
    description: 'Belirli bir süre bekler (assertion timeout için).',
    capability: 'events.read',
    milestone: 'M0',
    args: [
      { name: 'duration', type: 'string', required: true, description: 'Bekleme süresi (örn: 5s, 500ms, 1tick)' },
    ],
  },
};

export interface ScenarioToolsInfo {
  readonly supervisor: () => Promise<SupervisorClient | null>;
  readonly scenariosDir: string;
}

export function createScenarioTools(info: ScenarioToolsInfo): Array<[ToolDefinition, ToolHandler]> {
  const scenarioValidate: [ToolDefinition, ToolHandler] = [
    {
      name: 'scenario_validate',
      title: 'Scenario validate',
      description: "Scenario dosyasını şemaya, step allowlist'ine ve mevcut capability'lere karşı doğrular; çalıştırmaz.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scenario_path: { type: 'string', description: 'Scenario dosya yolu' },
        },
        required: ['scenario_path'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const scenarioPath = args['scenario_path'];
      if (typeof scenarioPath !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'scenario_path' });
      }

      if (!existsSync(scenarioPath)) {
        return toolError(ctx.correlationId, 'SCENARIO_SCHEMA_INVALID', {
          path: scenarioPath,
          message: 'Scenario dosyası bulunamadı.',
        });
      }

      try {
        const content = readFileSync(scenarioPath, 'utf8');
        const scenario = parseYaml(content) as Record<string, unknown>;

        const errors: Array<{ field: string; message: string }> = [];

        if (typeof scenario !== 'object' || scenario === null) {
          return toolError(ctx.correlationId, 'SCENARIO_SCHEMA_INVALID', {
            message: 'Scenario geçerli bir YAML nesnesi değil.',
          });
        }

        if (typeof scenario['schema'] !== 'string') {
          errors.push({ field: 'schema', message: 'schema alanı zorunludur.' });
        }

        if (typeof scenario['name'] !== 'string') {
          errors.push({ field: 'name', message: 'name alanı zorunludur.' });
        }

        if (!Array.isArray(scenario['steps'])) {
          errors.push({ field: 'steps', message: 'steps alanı zorunlu bir dizidir.' });
        } else {
          const steps = scenario['steps'] as Array<Record<string, unknown>>;

          if (steps.length > 50) {
            return toolError(ctx.correlationId, 'SCENARIO_STEP_LIMIT_EXCEEDED', {
              step_count: steps.length,
              max: 50,
            });
          }

          for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const stepName = (step?.['step'] ?? step?.['action']) as string | undefined;

            if (typeof stepName !== 'string') {
              errors.push({ field: `steps[${i}]`, message: 'step alanı zorunludur.' });
              continue;
            }

            if (!(DSL_STEP_ALLOWLIST as readonly string[]).includes(stepName)) {
              return toolError(ctx.correlationId, 'SCENARIO_STEP_NOT_ALLOWED', {
                step: stepName,
                index: i,
                allowed_steps: [...DSL_STEP_ALLOWLIST],
              });
            }
          }
        }

        if (errors.length > 0) {
          return toolError(ctx.correlationId, 'SCENARIO_SCHEMA_INVALID', {
            errors,
            path: scenarioPath,
          });
        }

        return toolSuccess(ctx.correlationId, {
          valid: true,
          path: scenarioPath,
          name: scenario['name'],
          step_count: Array.isArray(scenario['steps']) ? (scenario['steps'] as unknown[]).length : 0,
          steps: Array.isArray(scenario['steps'])
            ? (scenario['steps'] as Array<Record<string, unknown>>).map((s) => ({
                step: s['step'] ?? s['action'],
              }))
            : [],
        });
      } catch (err) {
        return toolError(ctx.correlationId, 'SCENARIO_SCHEMA_INVALID', {
          path: scenarioPath,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  ];

  const scenarioRun: [ToolDefinition, ToolHandler] = [
    {
      name: 'scenario_run',
      title: 'Scenario run',
      description: "Scenario'yu kendi disposable runtime'ında çalıştırır, assertion'ları değerlendirir ve evidence toplar.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scenario_path: { type: 'string', description: 'Scenario dosya yolu' },
          project_id: { type: 'string', description: 'Proje kimliği' },
          accept_minecraft_eula: {
            type: 'boolean',
            description: 'Minecraft EULA\'sını kabul et (scenario gerçek bir Paper sunucusu başlatır; false verilirse sunucu başlamaz)',
          },
          build_id: {
            type: 'string',
            description: 'Plugin eklenecekse build kaydı kimliği (opsiyonel; verilmezse pluginsiz runtime)',
          },
        },
        required: ['scenario_path', 'project_id', 'accept_minecraft_eula'],
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const scenarioPath = args['scenario_path'];
      const projectId = args['project_id'];
      const acceptMinecraftEula = args['accept_minecraft_eula'];
      const buildId = args['build_id'];

      if (typeof scenarioPath !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'scenario_path' });
      }
      if (typeof projectId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'project_id' });
      }
      if (typeof acceptMinecraftEula !== 'boolean') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'accept_minecraft_eula' });
      }
      if (buildId !== undefined && typeof buildId !== 'string') {
        return toolError(ctx.correlationId, 'TOOL_INPUT_INVALID', { field: 'build_id' });
      }

      const client = await info.supervisor();
      if (!client) {
        return toolError(ctx.correlationId, 'SUPERVISOR_UNAVAILABLE');
      }

      try {
        const result = await client.call<ScenarioRunResult>('scenario.run', {
          scenarioPath,
          projectId,
          acceptMinecraftEula,
          ...(buildId !== undefined && { buildId }),
        });

        if (result.status === 'failed') {
          return toolError(ctx.correlationId, 'ASSERTION_FAILED', {
            scenario_run_id: result.scenarioRunId,
            passed: result.passed,
            failed: result.failed,
            duration_ms: result.durationMs,
          });
        }

        return toolSuccess(ctx.correlationId, {
          scenario_run_id: result.scenarioRunId,
          status: result.status,
          passed: result.passed,
          failed: result.failed,
          skipped: result.skipped,
          duration_ms: result.durationMs,
          evidence_ids: result.evidenceIds,
        });
      } catch (err) {
        const error = err as { code?: string; message?: string };
        return toolError(ctx.correlationId, (error.code ?? 'SCENARIO_TIMEOUT') as never, {
          scenario_path: scenarioPath,
          project_id: projectId,
          message: error.message ?? String(err),
        });
      }
    },
  ];

  const scenarioStepCatalog: [ToolDefinition, ToolHandler] = [
    {
      name: 'scenario_step_catalog',
      title: 'Scenario step catalog',
      description: "Mevcut scenario step'lerinin listesini ve argüman şemalarını döndürür. Agent'ların hangi adımları kullanabileceğini görmesini sağlar.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          step_name: { type: 'string', description: 'Belirli bir adımın detaylarını getirmek için (opsiyonel)' },
          milestone: { type: 'string', description: 'Milestone filtresi: M0, M2A, M2B (opsiyonel)' },
        },
      },
      outputSchema: TOOL_RESULT_SCHEMA_REF,
    },
    async (args, ctx) => {
      const stepName = args['step_name'] as string | undefined;
      const milestone = args['milestone'] as string | undefined;

      // Belirli bir adım istenmişse
      if (stepName) {
        const schema = STEP_SCHEMAS[stepName];
        if (!schema) {
          return toolError(ctx.correlationId, 'SCENARIO_STEP_NOT_ALLOWED', {
            step: stepName,
            allowed_steps: Object.keys(STEP_SCHEMAS),
          });
        }

        return toolSuccess(ctx.correlationId, {
          step: stepName,
          ...schema,
        });
      }

      // Milestone filtresi
      let steps = Object.entries(STEP_SCHEMAS);
      if (milestone) {
        steps = steps.filter(([, schema]) => schema.milestone === milestone);
      }

      return toolSuccess(ctx.correlationId, {
        steps: steps.map(([name, schema]) => ({
          name,
          description: schema.description,
          capability: schema.capability,
          milestone: schema.milestone,
          arg_count: schema.args.length,
          required_args: schema.args.filter((a) => a.required).map((a) => a.name),
        })),
        total: steps.length,
        allowlist: [...DSL_STEP_ALLOWLIST],
      });
    },
  ];

  return [scenarioValidate, scenarioRun, scenarioStepCatalog];
}
