# Paper Bridge

Paper JVM'i içinde çalışan gözlem eklentisi. **Ayrı bir işletim sistemi process'i değildir** (ADR-0001).

## Güvenlik sınırı

> Bridge auth, aynı Paper JVM'i içinde çalışan aktif kötü niyetli hedef plugin'e karşı **tam güvenlik sınırı değildir.**

Ayrıntı: [`../../docs/security/guarantees.md`](../../docs/security/guarantees.md), [`../../docs/adr/0007-security-claims.md`](../../docs/adr/0007-security-claims.md).

T2 sınıfı projeler Container backend içinde çalıştırılmalıdır.

## Sürüm kaynağı

`build.gradle.kts` sürümleri **uyumluluk profilinden okur**; build script'inde gömülü sürüm sabiti yoktur:

- `paper.api_coordinate` → `compileOnly` bağımlılığı
- `paper.api_version` → `plugin.yml` `api-version`
- `java.toolchain_major` → Java toolchain

Profil: [`../../compatibility/paper-26.2-build-84-v1.yaml`](../../compatibility/paper-26.2-build-84-v1.yaml)

> ⚠️ Profil `verification.status: unverified` durumundadır. `paper.api_coordinate` biçimi (`26.2.build.84-stable`) Paper'ın bilinen Maven şemasından farklıdır ve `SPIKE-PAPER-DOWNLOAD-001` ile doğrulanmalıdır. Doğrulanana kadar bu proje derlenmeyebilir.

## Generated kaynaklar

`src/main/java/io/github/mcpdev/bridge/generated/` altındaki dosyalar capability registry ve error catalog'dan üretilir:

```bash
pnpm run gen
```

Eksiklerse `compileJava` erken ve anlaşılır biçimde başarısız olur (`checkGeneratedSources`).

## Wrapper

Gradle Wrapper dosyaları (`gradlew`, `gradle-wrapper.jar`, `gradle-wrapper.properties`) bu iskelette **bulunmamaktadır**; `gradle wrapper --gradle-version <profil sürümü>` ile üretilmeli ve ardından:

- `distributionSha256Sum` eklenmeli,
- wrapper JAR checksum'ı kaydedilmeli,
- `gradle/verification-metadata.xml` ve lock dosyaları üretilmelidir.

Bunlar `project_validate` tarafından zorunlu tutulur — bkz. [`../../docs/security/supply-chain.md`](../../docs/security/supply-chain.md).

## M0 kapsamı

| Durum | Bileşen |
|---|---|
| ✅ | Plugin yaşam döngüsü (`onEnable` / `onDisable`) |
| ✅ | `bridge_boot_id` ve boot içi monoton event sequence |
| ✅ | Loopback HTTP sunucusu + Bearer token auth (sabit süreli karşılaştırma) |
| ✅ | Host/Origin doğrulaması (DNS rebinding koruması) |
| ✅ | Bounded worker havuzu ve kuyruk, gövde boyut limiti |
| ✅ | Handshake dosyası — **secret içermez**, atomik yazılır |
| ✅ | `/v1/health`, `/v1/capabilities`, `/v1/events`, `/v1/query` |
| ✅ | Capability manifest registry'den üretilen enum'dan türetilir |
| ✅ | Bounded event ring buffer + cursor doğrulaması |
| ✅ | Scheduler executor (timeout'ta görevi **iptal eder**) |
| ✅ | Read operation'lar: server/plugin/world/player |
| ⬜ | Gerçek Paper smoke testi (5 lifecycle) |

**66 JUnit testi** geçiyor:

| Sınıf | Test |
|---|---:|
| `BridgeEndpointsTest` | 20 |
| `BridgeHttpServerTest` | 13 |
| `EventRingBufferTest` | 11 |
| `QueryDispatcherTest` | 9 |
| `BridgeRuntimeContextTest` | 6 |
| `HandshakeFileTest` | 4 |
| `BridgeBootTest` | 3 |

## Katman ayrımı

Bukkit'e dokunan **tek** sınıf `PaperReadOperations`'tır. HTTP, dispatch, event tamponu ve doğrulama katmanları Bukkit'ten bağımsızdır — bu sayede 66 testin tamamı gerçek bir Minecraft sunucusu olmadan koşar. Auth ve limit davranışını doğrulamak için Paper başlatmak zorunda kalmak, bu testlerin CI'da koşulmasını pratikte engellerdi.

## Query ucu salt okumadır

`/v1/query` yalnızca `QueryDispatcher.READ_ONLY` kümesindeki operation'ları kabul eder. `world.set_block` gibi mutation'lar reddedilir: mutation idempotency key, seri kuyruk ve mutation ledger gerektirir; query yoluna sızmaları kör retry'a kapı açardı.

## JSON

Bridge'de genel amaçlı JSON kütüphanesi **yoktur** (aynı JVM'de hedef plugin ile classpath paylaşıldığı için). `JsonReader` sert sınırlar taşır: maksimum derinlik 16, maksimum eleman 512, sondaki fazlalık içerik reddedilir, **yinelenen anahtar reddedilir** (ayrıştırıcı farkı istismarına karşı).

## Yönetilen runtime dışında atıl kalır

Bridge, HTTP sunucusunu yalnızca şu üçü birden sağlandığında başlatır:

```text
-Dmcpdev.runtime.root=<runtime kökü>
-Dmcpdev.server.instance.id=srv_...
```

artı runtime kökünde `.mcpdev-runtime` marker dosyası **ve** `bridge-token` dosyası.

Biri eksikse Bridge uyarı loglar ve **kontrol yüzeyini açmaz**. Bu bilinçlidir: JAR yanlışlıkla ya da kötü niyetle sıradan bir Paper sunucusuna atıldığında kimlik doğrulamalı bir HTTP yüzeyi kendiliğinden açılmamalıdır. Test: `BridgeRuntimeContextTest`.

## Token akışı

Token **handshake dosyasında bulunmaz** (BR-05):

1. Supervisor rastgele token üretir.
2. Runtime kökünde dar izinli `bridge-token` dosyasına yazar.
3. Bridge açılışta okur.
4. Bridge `bridge-handshake.json` dosyasına yalnızca port ve protokol metadata'sı yazar.

Handshake dosyası tanım gereği okunabilir olmak zorundadır; token'ı oraya koymak "bağlantı bilgisi" ile "yetki"yi aynı okunabilir dosyada birleştirirdi.

M0 kabul kriteri: **plugin disable sonrası Bridge thread'i veya açık portu kalmamalıdır** — `BridgeHttpServerTest.closeReleasesPortAndThreads` bunu doğrular.
