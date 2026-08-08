# Scenarios

Scenario DSL v1 dosyaları. Sözleşme: [`../docs/contracts/scenario-dsl.md`](../docs/contracts/scenario-dsl.md)
Şema: [`../packages/contracts/schemas/scenario/scenario.schema.json`](../packages/contracts/schemas/scenario/scenario.schema.json)

```text
smoke/          Temel yaşam döngüsü
configuration/  Config hatası senaryoları
permissions/    İzin davranışı (M2B)
commands/       Typed command davranışı (M2B)
world/          Dünya durumu ve blok davranışı
```

## Değişmez kurallar

| # | Kural |
|---|---|
| DSL-01 | YAML yalnızca **veri**dir |
| DSL-05 | **Raw command string yok** — komutlar yalnızca `command_id` ile |
| DSL-06 | Step allowlist capability registry'den üretilir |
| DSL-11 | Scenario'lar runtime paylaşmaz |

`requires.capabilities` **zorunludur**: M2B kapalıyken actor gerektiren bir scenario `scenario_validate` aşamasında `CAPABILITY_UNAVAILABLE` ile reddedilir — sessizce atlanmaz veya sahte geçmez.

## Mevcut

| Scenario | Actor gerektirir | Milestone |
|---|---|---|
| [`smoke/plugin-enables.yaml`](smoke/plugin-enables.yaml) | Hayır | M2A |
| [`world/set-block.yaml`](world/set-block.yaml) | Hayır | M2A |
| [`world/read-block.yaml`](world/read-block.yaml) | Hayır | M2A |
| [`world/chunk-ticket.yaml`](world/chunk-ticket.yaml) | Hayır | M2A |

## Bekleme modeli

Sabit uyku (`sleep`) **yasaktır**. `within` bir üst sınırdır, bir bekleme değil: koşul sağlanır sağlanmaz assertion geçer.

```yaml
- assert.event:
    type: block.break
    cancelled: true
    within: 5s
    poll_interval: 1tick
```
