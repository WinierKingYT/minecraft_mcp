# Scenario DSL v1

Sürüm: `scenario_dsl: 1`
Şema: [`../../packages/contracts/schemas/scenario/scenario.schema.json`](../../packages/contracts/schemas/scenario/scenario.schema.json)

## İlkeler

| # | İlke |
|---|---|
| DSL-01 | YAML yalnızca **veri**dir |
| DSL-02 | Güvenli parser kullanılır |
| DSL-03 | Custom YAML tag yok |
| DSL-04 | Include/import yok |
| DSL-05 | **Raw command string yok** |
| DSL-06 | Step allowlist |
| DSL-07 | Capability validation |
| DSL-08 | Risk metadata |
| DSL-09 | Maksimum step ve timeout |
| DSL-10 | Cleanup her terminal durumda denenir |
| DSL-11 | Scenario başka scenario ile aynı runtime'ı paylaşmaz |
| DSL-12 | `expect` bloğu beklenen terminal durumu ve hata kodunu sözleşmeye bağlar |

DSL-03 ve DSL-04 birlikte, scenario dosyasının bir *program* değil bir *veri belgesi* olmasını garanti eder. DSL-05, ajanın sunucuya keyfî komut göndermesinin tek kapalı kapısıdır: komutlar yalnızca plugin test contract'ında tanımlı `command_id` üzerinden çağrılır.

## Örnek

```yaml
version: 1
id: claim-block-break-protection
title: Başkasının claim alanında blok kırılamaz
profile: isolated-test
timeout: 60s

requires:
  plugin_contract: claim-plugin
  capabilities:
    - test_actor.protocol
    - world.block.write
    - player.break_block
    - plugin.command.typed
    - events.read

given:
  - test_actor.create:
      id: owner
      position: { world_key: minecraft:overworld, x: 0, y: 64, z: 0 }

  - test_actor.create:
      id: intruder
      position: { world_key: minecraft:overworld, x: 10, y: 64, z: 10 }

  - world.set_block:
      position: { world_key: minecraft:overworld, x: 10, y: 64, z: 10 }
      material: minecraft:stone

  - plugin.command:
      actor: owner
      command_id: claim_create
      arguments:
        corner1: { x: 0, y: 0, z: 0 }
        corner2: { x: 20, y: 255, z: 20 }

when:
  - player.break_block:
      actor: intruder
      position: { world_key: minecraft:overworld, x: 10, y: 64, z: 10 }

then:
  - assert.block:
      position: { world_key: minecraft:overworld, x: 10, y: 64, z: 10 }
      material: minecraft:stone
      within: 2s

  - assert.event:
      type: block.break
      actor: intruder
      cancelled: true
      within: 5s

  - assert.player_message:
      actor: intruder
      message_key: claim_protected
      within: 5s

  - assert.no_log:
      level_at_least: ERROR

cleanup:
  - actor.disconnect_all: {}
```

`requires.capabilities` alanı zorunludur: `scenario_validate` eksik capability'yi çalıştırmadan önce bildirir, böylece M2B kapalıyken actor gerektiren scenario sessizce atlanmaz.

## Assertion sonucu

```json
{
  "assertion_id": "assert_04",
  "type": "block.material",
  "status": "FAILED",
  "expected": "minecraft:stone",
  "observed": "minecraft:air",
  "observed_at_tick": 4820,
  "evidence_ids": ["ev_events_01", "ev_logs_04", "ev_block_02"]
}
```

`expected` / `observed` / `evidence_ids` üçlüsü zorunludur (KPI-08). Kanıt kimliği taşımayan assertion sonucu şema doğrulamasından geçmez.

## Beklenen hata scenario'ları (DSL-12)

Config error scenario'ları, run'ın belirli bir terminal durumda bitmesini bekleyen `expect` bloğu taşır. Beklenti karşılanırsa scenario **completed** sayılır; karşılanmazsa **failed**:

```yaml
expect:
  status: failed
  error_code: REGION_NOT_ALLOWED
```

Kurallar:

- `status` zorunludur; `completed | failed | timed_out` olabilir.
- `error_code` opsiyoneldir; error catalog koduyla birebir eşleşmelidir (`^[A-Z][A-Z0-9_]*$`). Bridge hata kodları sınırda çevrilmez, olduğu gibi taşınır.
- `status: failed` bekleyen scenario'da `then` boş olabilir — hata `when` (veya `given`) fazında beklenir; başarı bekleyen scenario'da `then` zorunludur.
- Adım sonuçları (passed/failed) her durumda gerçek durumu yansıtır; yalnızca scenario düzeyi durum expect'e göre çözülür. İlk hatalı adımın `errorCode` alanı karşılaştırma için kullanılır.
