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
| [`configuration/region-not-allowed.yaml`](configuration/region-not-allowed.yaml) | Hayır | M2A |
| [`configuration/material-not-allowed.yaml`](configuration/material-not-allowed.yaml) | Hayır | M2A |
| [`configuration/chunk-not-loaded.yaml`](configuration/chunk-not-loaded.yaml) | Hayır | M2A |

## Beklenen hata scenario'ları (DSL-12)

Config error scenario'ları `expect` bloğu taşır: run'ın belirli bir terminal durumda ve (isteniyorsa) belirli bir hata koduyla bitmesini bekler. Beklenti karşılanırsa scenario **completed** sayılır; karşılanmazsa **failed**. Status `failed` olan expect, `then` fazının boş olmasına izin verir — hata `when` fazında beklenir:

```yaml
expect:
  status: failed
  error_code: REGION_NOT_ALLOWED
```

Adım sonuçları yine failed olarak raporlanır (kullanıcıya gerçek durum görünür); yalnızca scenario düzeyi durum çevrilir. Hata kodu, bridge'den olduğu gibi taşınan error catalog kodudur (örn. `REGION_NOT_ALLOWED`, `MATERIAL_NOT_ALLOWED`, `CHUNK_NOT_LOADED`).

## Bekleme modeli

Sabit uyku (`sleep`) **yasaktır**. `within` bir üst sınırdır, bir bekleme değil: koşul sağlanır sağlanmaz assertion geçer.

```yaml
- assert.event:
    type: block.break
    cancelled: true
    within: 5s
    poll_interval: 1tick
```
