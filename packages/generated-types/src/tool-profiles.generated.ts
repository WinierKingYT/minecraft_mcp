// Bu dosya `pnpm run gen` tarafından üretilir. ELLE DÜZENLEMEYİN.

// Sıra normatiftir (docs/contracts/mcp.md TL-04): aynı profilde tool sırası
// deterministik olmalıdır.
export const TOOL_PROFILES = {
  'developer': [
    'system_health',
    'system_capabilities',
    'project_inspect',
    'project_validate',
    'plugin_build',
    'plugin_launch',
    'plugin_stop',
    'plugin_diagnose',
    'operation_get',
    'operation_cancel',
    'scenario_validate',
    'scenario_run',
    'evidence_get',
  ],
  'debug': [
    'runtime_create',
    'runtime_start',
    'runtime_get',
    'runtime_stop',
    'runtime_release',
    'minecraft_server_get',
    'minecraft_plugin_list',
    'minecraft_plugin_get',
    'minecraft_world_list',
    'minecraft_world_get_block',
    'minecraft_events_query',
    'minecraft_player_get',
  ],
  'scenario-authoring': [
    'scenario_step_catalog',
    'fixture_inspect',
    'actor_capabilities',
    'scenario_validate',
    'scenario_run',
    'evidence_get',
  ],
} as const;

export type ToolProfileName = keyof typeof TOOL_PROFILES;

export const DEFAULT_TOOL_PROFILE: ToolProfileName = 'developer';
