# Deterministik runtime ve fixture modeli

## Disposable runtime per scenario

**Karar (kritik):** V1'de aynı çalışan Paper server `fixture_reset` ile tekrar tekrar sıfırlanmaz.

Gerekçe: bir Paper server'ın "temiz duruma döndürülmesi" pratikte kanıtlanamaz. Kalan entity'ler, chunk cache'i, plugin static state'i ve scheduler'da bekleyen görevler scenario'lar arasında sızar. Sızıntının kaynağını bulmak, disposable runtime'ın maliyetinden pahalıdır.

Her scenario:

1. Source/artifact seçer
2. Yeni runtime hazırlar
3. Fixture kopyalar
4. Determinism profile uygular
5. Paper başlatır
6. Scenario çalıştırır
7. Evidence toplar
8. Paper kapatır
9. Runtime release eder

Scenario'lar runtime paylaşmaz — cross-contamination testi M2A kabul kriteridir.

## Fixture manifest

```yaml
fixture_id: flat-world-v1
version: 1
source_sha256: "sha256:..."
world_seed: 123456789
supported_profile: paper-26.2-build-84-v1

regions:
  fixture-area:
    world_key: minecraft:overworld
    min: { x: -64, y: -64, z: -64 }
    max: { x: 64, y: 320, z: 64 }

allowed_materials:
  - minecraft:air
  - minecraft:stone
  - minecraft:dirt
  - minecraft:grass_block
  - minecraft:chest
```

`regions` ve `allowed_materials` yalnızca dokümantasyon değildir: `world.set_block` capability'si `limits.region` üzerinden bu bölgeye kısıtlanır ve bölge dışı yazma `REGION_NOT_ALLOWED` döndürür.

### Fixture bölgesi yüklü tutulmalıdır

**Ölçülmüş bulgu (Paper 26.2 build 84):** oyuncu bağlı değilken hiçbir chunk yüklü kalmaz; `server.properties` içindeki `spawn-chunk-radius` bunu değiştirmez.

Okuma operation'ları chunk **yükletmez** — bir okumanın dünya üretimi tetiklemesi hem yavaşlar hem "salt okuma" iddiasını bozar. Bu yüzden `world.get_block` yüklü olmayan bir chunk için `CHUNK_NOT_LOADED` döndürür.

**Karar (M2A):** Runtime hazırlanırken fixture manifest'indeki `regions` tanımına göre açık **chunk ticket'ı** alınır; scenario bitiminde bırakılır. Deterministik blok assertion'ının ön koşulu budur.

`world.list`, her dünya için `spawn_chunk_loaded` alanını bildirir; çağıran hangi konumun okunabilir olduğunu önceden bilir.

## Determinism profile

```yaml
id: deterministic-default-v1

world:
  seed: 123456789
  difficulty: peaceful
  time: 6000
  weather: clear
  random_tick_speed: 0

gamerules:
  doDaylightCycle: false
  doWeatherCycle: false
  doMobSpawning: false
  doPatrolSpawning: false
  doTraderSpawning: false
  doInsomnia: false
  keepInventory: true

server:
  online_mode: false
  max_players: 4
  view_distance: 4
  simulation_distance: 4
  spawn_protection: 0

process:
  timezone: UTC
  file_encoding: UTF-8
  locale: en_US
```

`online_mode: false` bir güvenlik gevşetmesi değil, offline test identity gereğidir; runtime ağa kapalıdır ve yalnızca loopback erişimi vardır.

## Wait modeli

**Karar:** Sabit uyku (`sleep`) yasaktır. Bekleme eventual assertion ile yapılır:

```yaml
- assert.event:
    type: block.break
    actor: intruder
    cancelled: true
    within: 5s
    poll_interval: 1tick
```

Gerekçe: sabit uyku hem yavaş makinede flaky, hem hızlı makinede gereksiz yavaştır. `within` bir üst sınırdır, bir beklemedir değil — koşul sağlanır sağlanmaz assertion geçer.
