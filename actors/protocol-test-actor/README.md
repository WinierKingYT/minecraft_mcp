# Protocol Test Actor

**Durum:** koşullu — `SPIKE-ACTOR-001` sonucuna bağlı (ADR-0006).

Bu dizin bilinçli olarak **boştur**. Actor'ın hangi kütüphane üzerine kurulacağı, lisansının ürünle uyumlu olup olmadığı ve CI'da güvenilir çalışıp çalışmadığı henüz bilinmemektedir. Doğrulanmamış bir bağımlılık üzerine iskelet kurmak, spike'ın sonucunu peşinen varsaymak olurdu.

## Karar kuralı

```text
Spike başarılı   -> M2B V1'de
Kısmen başarılı  -> yalnızca doğrulanan capability'ler V1'de
Başarısız        -> M2B V1.1'e
```

Spike: [`../../docs/delivery/spikes/SPIKE-ACTOR-001.md`](../../docs/delivery/spikes/SPIKE-ACTOR-001.md)
Strateji: [`../../docs/testing/actor-strategy.md`](../../docs/testing/actor-strategy.md)

## Değişmez kısıtlar (spike sonucundan bağımsız)

1. Actor **gerçek kullanıcı hesabı veya production credential taşımaz.**
2. Yalnızca test runtime'a bağlanır.
3. CI uyumlu offline test identity kullanır.
4. Capability negotiation ile desteklenen eylemleri bildirir.
5. Ayrı process'tir; Paper JVM'i içinde çalışmaz.

## M2B kapalıyken davranış

Actor gerektiren capability'ler (`test_actor.protocol`, `player.break_block`, `plugin.command.typed`, `actor.message.read`, `actor.disconnect`) registry'de `status: conditional` taşır.

Tool listesi bundan **etkilenmez** (docs/contracts/mcp.md TL-02): `actor_capabilities` tool'u `scenario-authoring` profilinde görünmeye devam eder ve çağrıldığında `CAPABILITY_UNAVAILABLE` döner. Actor gerektiren bir scenario `scenario_validate` aşamasında açıkça reddedilir — sessizce atlanmaz.
