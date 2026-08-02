# Capability Registry

Kaynak: [`../../packages/capability-registry/capabilities/`](../../packages/capability-registry/capabilities/)
Şema: [`../../packages/capability-registry/schema/capability.schema.json`](../../packages/capability-registry/schema/capability.schema.json)

## Tek gerçek kaynak

Her capability ayrı YAML kaydıdır:

```yaml
id: world.block.write
version: 1
milestone: M2A

exposure:
  developer_tool: false
  debug_tool: minecraft_world_set_block
  bridge_operation: world.set_block
  dsl_step: world.set_block

risk:
  effect: mutation
  scope: fixture
  reversibility: runtime_discard
  approval: profile
  exposure: agent_visible
  cost: low
  level: R2

contracts:
  input: schemas/world-set-block.input.json
  output: schemas/world-set-block.output.json

limits:
  max_blocks: 1
  timeout_ms: 2000
  region: fixture-area

tests:
  contract: [CT-WORLD-SET-001]
  integration: [IT-WORLD-SET-001]
  security: [ST-WORLD-SET-001]
```

Registry'den **otomatik üretilir**:

- MCP tool definition
- Java enum / DTO
- TypeScript types
- Scenario DSL schema
- Risk matrisi
- Documentation tabloları
- Contract test stub'ları

**Karar:** Capability veya error tablosu elle iki farklı dilde kopyalanamaz. `pnpm run gen:check` drift tespit ederse CI kırılır.

## Risk metadata → seviye türetimi

```yaml
effect:        read | build | process | mutation | delete
scope:         fixture | disposable_runtime | project | host | production
reversibility: reversible | runtime_discard | snapshot_recoverable | destructive
approval:      none | profile | per_call
exposure:      internal | agent_visible
cost:          low | bounded | high
```

Türetim kuralı (`scripts/generate-contracts.mjs` içinde uygulanır). Kurallar yukarıdan aşağıya değerlendirilir; **ilk eşleşen** seviye kazanır:

| Seviye | Koşul |
|---|---|
| R4 | `effect: delete` **veya** `scope: host \| production` **veya** `reversibility: destructive` |
| R3 | `reversibility: snapshot_recoverable` **veya** (`effect: mutation \| process` ve `scope: project`) |
| R2 | `effect: mutation` ve `scope: fixture \| disposable_runtime` ve `reversibility: runtime_discard` |
| R1 | `effect: build \| process` ve `scope: disposable_runtime` **veya** (`effect: read` ve `scope: project`) |
| R0 | `effect: read` ve `scope: fixture \| disposable_runtime` |

Salt okuma, kapsamı `project` olsa bile en fazla R1'dir: bir kaynak ağacını okumak onu değiştirmekle aynı risk sınıfında değildir.

**Karar:** R3 ve R4 capability'leri V1'de `exposure.developer_tool: null` olmak zorundadır; agent-facing destructive tool yoktur.

`risk.level` kaydın içinde elle yazılır **ve** generator tarafından yeniden hesaplanıp doğrulanır. Uyuşmazlık CI hatasıdır — bu, seviyeyi elle düşürerek bir capability'yi agent'a açmayı imkânsız kılar.

## Tool profilleri

### `developer` (varsayılan, agent-facing)

```text
system_health
system_capabilities
project_inspect
project_validate
plugin_build
plugin_launch
plugin_stop
plugin_diagnose
operation_get
operation_cancel
scenario_validate
scenario_run
evidence_get
```

### `debug`

```text
runtime_create
runtime_start
runtime_get
runtime_stop
runtime_release
minecraft_server_get
minecraft_plugin_list
minecraft_plugin_get
minecraft_world_list
minecraft_world_get_block
minecraft_events_query
minecraft_player_get
```

### `scenario-authoring`

```text
scenario_step_catalog
fixture_inspect
actor_capabilities
scenario_validate
scenario_run
evidence_get
```

## İç orkestrasyon araç değildir

Aşağıdakiler agent-facing tool **değildir** ve capability kaydında `exposure.developer_tool: false`, `exposure.debug_tool: null` taşır:

- artifact install
- runtime directory delete
- report export internals
- build result polling detail
- evidence file path management
- Paper process spawn arguments

## Üretilmiş risk matrisi

Aşağıdaki tablo `pnpm run gen` tarafından yenilenir; elle düzenlenmez.

<!-- BEGIN GENERATED: risk-matrix -->
| Capability | Milestone | Effect | Scope | Reversibility | Approval | Level | Developer tool | Debug tool |
|---|---|---|---|---|---|---|---|---|
| `actor.capabilities` | M2B | read | disposable_runtime | reversible | none | **R0** | — | — |
| `actor.disconnect` | M2B | process | disposable_runtime | runtime_discard | none | **R1** | — | — |
| `actor.message.read` | M2B | read | disposable_runtime | reversible | none | **R0** | — | — |
| `build.run` | M1 | build | disposable_runtime | reversible | profile | **R1** | `plugin_build` | — |
| `events.read` | M0 | read | disposable_runtime | reversible | none | **R0** | — | `minecraft_events_query` |
| `evidence.read` | M1 | read | disposable_runtime | reversible | none | **R0** | `evidence_get` | — |
| `fixture.inspect` | M2A | read | fixture | reversible | none | **R0** | — | — |
| `logs.read` | M0 | read | disposable_runtime | reversible | none | **R0** | — | — |
| `operation.cancel` | M0 | process | disposable_runtime | reversible | none | **R1** | `operation_cancel` | — |
| `operation.read` | M0 | read | disposable_runtime | reversible | none | **R0** | `operation_get` | — |
| `player.break_block` | M2B | mutation | fixture | runtime_discard | profile | **R2** | — | — |
| `player.state.read` | M0 | read | disposable_runtime | reversible | none | **R0** | — | `minecraft_player_get` |
| `plugin.command.typed` | M2B | mutation | disposable_runtime | runtime_discard | profile | **R2** | — | — |
| `plugin.diagnose` | M1 | read | disposable_runtime | reversible | none | **R0** | `plugin_diagnose` | — |
| `plugin.get` | M0 | read | disposable_runtime | reversible | none | **R0** | — | `minecraft_plugin_get` |
| `plugin.list` | M0 | read | disposable_runtime | reversible | none | **R0** | — | `minecraft_plugin_list` |
| `project.inspect` | M1 | read | project | reversible | profile | **R1** | `project_inspect` | — |
| `project.validate` | M1 | read | project | reversible | profile | **R1** | `project_validate` | — |
| `runtime.create` | M1 | build | disposable_runtime | runtime_discard | profile | **R1** | — | `runtime_create` |
| `runtime.delete` | M1 | delete | host | destructive | per_call | **R4** | — | — |
| `runtime.inspect` | M1 | read | disposable_runtime | reversible | none | **R0** | — | `runtime_get` |
| `runtime.launch` | M1 | process | disposable_runtime | runtime_discard | profile | **R1** | `plugin_launch` | `runtime_start` |
| `runtime.release` | M1 | process | disposable_runtime | runtime_discard | none | **R1** | — | `runtime_release` |
| `runtime.stop` | M1 | process | disposable_runtime | runtime_discard | none | **R1** | `plugin_stop` | `runtime_stop` |
| `scenario.run` | M2A | process | disposable_runtime | runtime_discard | profile | **R1** | `scenario_run` | — |
| `scenario.step_catalog` | M2A | read | fixture | reversible | none | **R0** | — | — |
| `scenario.validate` | M2A | read | fixture | reversible | none | **R0** | `scenario_validate` | — |
| `server.state.read` | M0 | read | disposable_runtime | reversible | none | **R0** | — | `minecraft_server_get` |
| `system.capabilities` | M0 | read | disposable_runtime | reversible | none | **R0** | `system_capabilities` | — |
| `system.health` | M0 | read | disposable_runtime | reversible | none | **R0** | `system_health` | — |
| `test_actor.protocol` | M2B | process | disposable_runtime | runtime_discard | profile | **R1** | — | — |
| `world.block.read` | M0 | read | fixture | reversible | none | **R0** | — | `minecraft_world_get_block` |
| `world.block.write` | M2A | mutation | fixture | runtime_discard | profile | **R2** | — | — |
| `world.list` | M0 | read | fixture | reversible | none | **R0** | — | `minecraft_world_list` |
<!-- END GENERATED: risk-matrix -->
