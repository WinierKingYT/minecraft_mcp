# ADR-0006 — M2A / M2B ayrımı

**Durum:** accepted
**Tarih:** 2026-07-29
**Güncelleme:** 2026-08-02 (SPIKE-ACTOR-001 kapatıldı)
**Bağlam:** REQ-008, REQ-011; [`../delivery/spikes/SPIKE-ACTOR-001.md`](../delivery/spikes/SPIKE-ACTOR-001.md)

## Bağlam

Davranış testlerinin bir kısmı gerçek bir oyuncu bağlantısı gerektirmiyor: plugin enable, config hatası, log assertion'ı, dünya durumu, generic event kontrolü. Bir kısmı ise gerektiriyor: login/join/quit, gerçek command packet, native permission context, blok kırma, inventory, mesaj yakalama.

İkinci grup, bir protokol istemcisine bağımlıdır. Protokol istemcileri Minecraft sürüm değişikliklerine en duyarlı ve CI'da en flaky bileşendir. Bu bağımlılığı ürünün tüm davranış testi yeteneğinin önüne koymak, V1'i tek bir üçüncü taraf kütüphanenin durumuna rehin bırakır.

## Karar

Davranış testi yeteneği iki milestone'a ayrılır:

| | M2A | M2B |
|---|---|---|
| **Kapsam** | Server-side deterministic scenarios | Gerçek player semantics |
| **Actor** | Gerektirmez | Gerektirir |
| **V1 durumu** | **Koşulsuz** | **Koşullu (kısmen başarılı)** |
| **Gate** | — | `SPIKE-ACTOR-001` (kapatıldı) |

Karar kuralı:

```text
Spike başarılı   -> M2B V1'de
Kısmen başarılı  -> yalnızca doğrulanan capability'ler V1'de
Başarısız        -> M2B V1.1'e
```

**Spike sonucu (2026-08-02):** Kısmen başarılı. NMS Reflection tabanlı yaklaşım benimsendi. Doğrulanmış capability'ler: `test_actor.protocol`, `player.break_block`, `player.move`, `player.look`, `player.chat`, `plugin.command.typed`, `actor.disconnect`. Kısmen doğrulanmış: `actor.message.read`, `player.state.read`.

Kısmi başarıda capability registry'de yalnızca doğrulanan `test_actor.*` kayıtları `milestone: M2B` kalır; kalanlar `milestone: V1.1` olur.

Scenario tarafında bu ayrım `requires.capabilities` üzerinden görünür: actor gerektiren bir scenario, M2B kapalıyken `scenario_validate` aşamasında **açıkça** eksik capability bildirir — sessizce atlanmaz veya sahte geçmez.

## Alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| Tüm davranış testlerini actor'a bağlamak | V1, tek bir flaky üçüncü taraf bileşene rehin olur; M2A'nın kanıtlanabilir değeri gecikir |
| Bridge operation'ları ile "oyuncu davranışını" simüle etmek ve actor'ı hiç yazmamak | Permission context, packet sırası ve iptal semantiği gerçekten test edilmez; plugin'in kendi listener'ı atlanabilir → **geçen ama yanlış test** |
| Actor'ı V1'den tamamen çıkarmak | JTBD-03'ün önemli bir bölümü (permission ve gerçek command) karşılanamaz |
| Kısmi başarıda tüm M2B'yi ertelemek | Doğrulanmış capability'lerin sağladığı değer gereksizce kaybedilir |
| Bağımsız protokol istemcisi (bot) | CI'da flaky, bakım yükü yüksek, sürüm bağımlılığı güçlü → NMS reflection tercih edildi |

## Sonuçlar

**Olumlu**

- M2A'nın V1'e girmesi actor'ın durumundan bağımsız.
- Flaky riski tek milestone'da izole.
- Kısmi başarı senaryosu için açık bir yol var.
- NMS reflection yaklaşımı, ayrı bir process ihtiyacını ortadan kaldırıyor.

**Olumsuz**

- İki assertion ailesi (Bridge kaynaklı / actor kaynaklı) ayrı evidence türleri ve ayrı belge bölümleri gerektirir.
- Bir scenario'nun M2A mı M2B mi olduğunu yazarın bilmesi gerekir → `scenario_step_catalog` ve `actor_capabilities` araçları bu yüzden `scenario-authoring` profilinde.
- Kullanıcıya "hangi testler çalışabilir" sorusu profil bağımlı bir cevap üretir.
- NMS reflection, Paper sürüm değişikliklerinde kırılabilir (ancak Mojang mappings stabilitesi yüksek).

**Kanıt:** `IT-SCENARIO-001` (M2A), `IT-ACTOR-001` (M2B), `scenario_validate` eksik capability testi.

## İlgili

- [`../testing/actor-strategy.md`](../testing/actor-strategy.md)
- [`../contracts/scenario-dsl.md`](../contracts/scenario-dsl.md)
