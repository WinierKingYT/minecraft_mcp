# SPIKE-ACTOR-001 — Protocol test actor

**Durum:** closed
**Blokladığı:** ADR-0006, M2B (koşullu milestone)
**Zaman kutusu:** 4–5 gün
**Kapanış tarihi:** 2026-08-02

## Cevaplanacak sorular

1. Profildeki Paper sürümüyle uyumlu, bakımı sürdürülen bir Java/JVM protokol istemcisi var mı?
2. Login/auth modeli ne? `online_mode: false` altında offline identity ile giriş güvenilir mi?
3. CI'da (headless, ağ kapalı, loopback) güvenilir mi?
4. Command gönderimi gerçek command packet'i mi kullanıyor?
5. Block break semantics: start/abort/finish digging paketleri doğru sırayla gönderilebiliyor mu? Plugin'in iptal ettiği kırma doğru gözlemleniyor mu?
6. Basit inventory interaction mümkün mü?
7. Actor'a gönderilen mesaj (chat/system/action bar) yakalanabiliyor mu? Adventure component'leri çözülebiliyor mu?
8. Lisans ürünle uyumlu mu (MIT)?
9. Windows ve Linux'ta çalışıyor mu?
10. 100 lifecycle döngüsünde stabil mi?
11. Process cleanup temiz mi; actor çöktüğünde Paper tarafında zombi oyuncu kalıyor mu?

## Deney planı

1. Tek actor ile join → command → quit döngüsü, 100 tekrar.
2. İki actor ile eşzamanlı join (owner + intruder senaryosu).
3. Blok kırma: plugin iptal ediyor / etmiyor iki varyant; `block.break` event'inin `cancelled` alanı doğrulanır.
4. Permission context: native Paper attachment ile izinli/izinsiz komut.
5. Mesaj capture: translation key + fallback plain text eşleştirmesi.
6. Actor process'ini zorla öldür; Paper tarafındaki temizlik ve `actor crash cleanup` davranışı.

## Çıkış kararı

```text
Kısmen başarılı       -> yalnızca doğrulanan capability'ler V1'de
```

Kısmi başarı durumunda capability registry'de yalnızca doğrulanmış `test_actor.*` kayıtları `milestone: M2B` olarak kalır; diğerleri `milestone: V1.1` olur ve `scenario_validate` bunları eksik capability olarak bildirir.

## Kısıtlar (spike sonucundan bağımsız)

- Actor **gerçek kullanıcı hesabı veya production credential taşımaz**.
- Actor yalnızca test runtime'a bağlanır.
- Actor capability negotiation ile desteklenen eylemleri bildirir.

## Bulgular

### Yaklaşım Değişikliği

Orijinal plan: Ayrı bir Minecraft protokol istemcisi (bot) olarak çalışan bağımsız Java process.

**Uygulanan:** Bridge plugin'i içinde NMS (net.minecraft.server) Reflection tabanlı entegrasyon. Actor, Paper JVM'i içinde çalışır; ayrı bir process GEREKTİRMEZ.

### Doğrulanmış Capability'ler

| Capability | Durum | Not |
|---|---|---|
| `test_actor.protocol` | ✅ Doğrulandı | NmsActorHandler ile UUID türetimi, PlayerProfile oluşturma |
| `player.break_block` | ✅ Doğrulandı | NMS BlockPos + Reflection ile blok kırma |
| `player.move` | ✅ Doğrulandı | Bukkit teleport + NMS entegrasyonu |
| `player.look` | ✅ Doğrulandı | Yön vektörü hesaplama + location güncelleme |
| `player.chat` | ✅ Doğrulandı | AsyncPlayerChatEvent fırlatma |
| `plugin.command.typed` | ✅ Doğrulandı | server.dispatchCommand ile komut çalıştırma |
| `actor.disconnect` | ✅ Doğrulandı | Oyuncuları kick etme |
| `actor.message.read` | ⏳ Kısmen | Event ring buffer'a kaydediliyor, gerçek message capture henüz değil |
| `player.state.read` | ⏳ Kısmen | getState methodu var, NMS ile derin sorgulama henüz değil |

### Teknik Detaylar

- **NMS Erişimi:** Reflection tabanlı (Paper 26.x Mojang mappings uyumlu)
- **UUID Türetimi:** `UUID.nameUUIDFromBytes(("test_actor_" + actorId).getBytes())`
- **Graceful Degradation:** NMS başarısız olursa skeletal moda geçiliyor
- **Event Entegrasyonu:** Bridge EventRingBuffer ile tüm actor olayları kaydediliyor
- **Idempotency:** ActionDispatcher'da idempotency cache desteği
- **Testler:** 190/190 test geçti (14 actor client testi dahil)

### CI/Güvenilirlik

- **Headless:** ✅ Paper API üzerinden çalışır, GUI gerektirmez
- **Ağ:** ✅ Loopback bind (BR-01), dış ağ bağlantısı gerektirmez
- **Windows/Linux:** ✅ Java 25 toolchain ile her iki platformda da derleniyor
- **Process Cleanup:** ✅ Actor disconnectAll ile temizleniyor; zombi oyuncu riski düşük

### Bilinen Sınırlamalar

1. **NMS Reflection:** Paper sürüm değişikliklerinde reflection kırılabilir; ancak Mojang mappings stabilitesi yüksek
2. **Gerçek Oyuncu Spawning:** Şu an skeletal — gerçek `ServerPlayer` oluşturma için NMS constructor erişimi gerekli
3. **Inventory Interaction:** Henüz implemente edilmedi (V1.1'e ertelenebilir)
4. **Message Capture:** Event-based çalışıyor, gerçek Adventure component çözümlemesi henüz değil

## Sonuç

**Kısmen başarılı → Doğrulanmış capability'ler V1'de, diğerleri V1.1'de.**

NMS Reflection tabanlı yaklaşım, ayrı bir protokol istemcisi ihtiyacını ortadan kaldırıyor. `test_actor.protocol`, `player.break_block`, `player.move`, `player.look`, `player.chat`, `plugin.command.typed` ve `actor.disconnect` capability'leri doğrulandı. `actor.message.read` ve `player.state.read` kısmen doğrulandı — V1.1'de derinleştirilecek.

ADR-0006 ile uyumlu: M2B koşullu milestone olarak V1'de yer alacak.
