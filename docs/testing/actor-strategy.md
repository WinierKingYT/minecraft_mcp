# Test actor stratejisi

Karar kaydı: [`../adr/0006-m2a-m2b-split.md`](../adr/0006-m2a-m2b-split.md)
Spike: [`../delivery/spikes/SPIKE-ACTOR-001.md`](../delivery/spikes/SPIKE-ACTOR-001.md)
Detaylı doküman: [`../contracts/actor-protocol.md`](../contracts/actor-protocol.md)

## Durum (2026-08-02)

**SPIKE-ACTOR-001 kapatıldı.** Kısmen başarılı sonuç:
- NMS Reflection tabanlı yaklaşım benimsendi
- Ayrı protokol istemcisi (bot) GEREKTİRMEZ
- 7 capability doğrulandı, 2'si kısmen

## Katmanlar

| Test katmanı | Yöntem | Durum |
|---|---|---|
| Unit | Saf mock / MockBukkit | ✅ Tamamlandı |
| Bridge contract | Mock client/server | ✅ Tamamlandı |
| Paper integration | Gerçek Paper | ⏳ E2E gerekli |
| Server-side setup | Bridge typed operations | ✅ Tamamlandı |
| Gerçek player semantics | NmsActorHandler | ✅ Kısmen |

## M2A — actor gerektirmez

- plugin startup
- config failure
- server/plugin/log assertion'ları
- world setup
- generic event kontrolleri
- Bridge setup operation'ları

M2A **koşulsuz** olarak V1 kapsamındadır.

## M2B — actor gerektirir

- login/join/quit
- gerçek command packet
- permission context
- block interaction
- inventory interaction
- actor message capture

M2B **conditional**dır. Doğrulanmış capability'ler V1'de, diğerleri V1.1'de.

## Neden ayrılıyorlar

Bir Bridge operation'ı ile "oyuncu blok kırdı" durumunu *simüle etmek* ile gerçek bir protokol istemcisinin blok kırması **aynı şey değildir**. İkincisi permission context, packet sırası ve iptal semantiğini gerçekten test eder; ilki plugin'in kendi listener'ını atlayabilir.

Buna karşılık bir protokol istemcisinin Paper sürüm değişikliklerine dayanıklılığı düşüktür ve CI'da en büyük flaky kaynağıdır. Bu nedenle actor'a bağımlı testler **ayrı ve şartlı** bir milestone'da tutulur; M2A'nın V1'e girmesi actor'ın durumundan bağımsızdır.

## Yaklaşım

**NMS Reflection tabanlı entegrasyon:**
- Paper JVM'i içinde çalışır
- Ayrı process GEREKTİRMEZ
- Mojang mappings ile uyumlu
- Graceful degradation (NMS başarısız olursa skeletal moda geç)

## Actor kısıtları

- Gerçek kullanıcı hesabı veya production credential kullanılmaz
- Yalnızca test runtime'a bağlanır
- Capability negotiation ile desteklenen eylemleri bildirir
- `online_mode: false` olan sunucularda çalıştırılır
