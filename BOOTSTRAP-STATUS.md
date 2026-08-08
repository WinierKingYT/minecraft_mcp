# Bootstrap durumu

**Kapsam:** V3 sözleşme belgesinin "İlk 15 iş günü" planındaki **Gün 1–5**.
**Tarih:** 2026-07-30
**Doğrulama:** `pnpm run check` uçtan uca **geçiyor** (18/18 test).

---

## Doğrulama sonuçları

```text
✓ check:parse      157 dosya, 30 gömülü kod bloğu
✓ check:registry   34 capability, 109 error kodu, 3 profil
✓ check:schemas    10 şema, 34 capability kaydı
✓ check:docs       74 markdown (DOC-GATE-01/02/03/05/06)
✓ gen:check        7 generated dosya güncel
✓ typecheck        5 TypeScript paketi
✓ test             18/18 (mcp-server 10, run-supervisor 8)

✓ bridge/paper     clean build + JUnit 3/3
                   dependency locking ve verification AKTİF
```

Ortam artık profile uygun:

| Bileşen | Kurulu | Profil |
|---|---|---|
| Node.js | 24.18.1 | 24.18.1 ✅ |
| Java | Temurin 25.0.4.7 | 25 ✅ |
| Gradle | 9.6.1 (wrapper) | 9.6.1 ✅ |
| Docker | — | Container backend için gerekli (ertelendi) |

---

## Uyumluluk profili doğrulandı

Profil artık `verification.status: partially_verified`. **Tüm uzak koordinatlar** resmî kaynaklardan teyit edildi:

| Alan | Sonuç |
|---|---|
| Paper 26.2 | ✅ Mevcut |
| Paper build 84 | ✅ Mevcut, kanal **STABLE** |
| Paper JAR SHA-256 | ✅ `defe82c1…8ca16` profile yazıldı |
| `io.papermc.paper:paper-api:26.2.build.84-stable` | ✅ **Biçim doğru** — Paper 26.x hattında `<mc>.build.<n>-<stage>` şemasına geçmiş |
| MCP protokol `2026-07-28` | ✅ **FINAL** (RC değil) |
| `@modelcontextprotocol/server` | ✅ **stable 2.0.0** yayınlanmış |
| `@modelcontextprotocol/node` | ✅ **stable 2.0.0** yayınlanmış |
| Node 24.18.0 | ✅ Mevcut, LTS "Krypton" |
| Gradle 9.6.1 | ✅ Mevcut, SHA-256 profile yazıldı |
| npm araç zinciri | ✅ Tüm pinler çözüldü, lockfile üretildi |
| Java 25 | ⏳ **Bekliyor** — geliştirme makinesinde Java 21 kurulu |

Bootstrap sırasındaki "`api_coordinate` biçimi şüpheli" endişesi **yersizdi**; koordinat doğru.

---

## Doğrulamanın ortaya çıkardığı üç bulgu

### 1. MCP 2026-07-28 stateless — `initialize` kaldırılmış

Revizyon `initialize` / `notifications/initialized` el sıkışmasını ve `Mcp-Session-Id` başlığını **kaldırmıştır**. Bootstrap sırasında yazılan protokol yüzeyi bu handshake'i uyguluyordu ve **yanlıştı**.

Düzeltildi: [ADR-0008](docs/adr/0008-stateless-protocol-and-stable-sdk.md). Sunucu artık stateless; `server/discover` opsiyonel, `tools/list` `ttlMs` + `cacheScope` taşıyor, kaldırılmış metotlar açık hata döndürüyor.

### 2. Stable SDK yayınlanmış — V1 release blocker'ı kalktı

ADR-0002 V1'i "stable 2.x SDK çıkana kadar" bloke ediyordu. `@modelcontextprotocol/server@2.0.0` **27 Temmuz 2026'da** yayınlanmış. ADR-0002'nin (b) maddesi ADR-0008 ile supersede edildi.

SDK'ya bağımlılık **hâlâ kurulmadı** (`mcp.sdk.linked: false`): stdout purity invariant'ının SDK altında da korunduğu kanıtlanmalı.

### 3. Backend eşleşme formülü kaynak belgede tersti

V3 belgesi kuralı `build_backend.security_level >= runtime_backend.security_level` yazıyordu. Bu, kendi düzyazı açıklamasının tersidir: container (2) ≥ local (1) doğru olduğundan formül, yasaklanmak istenen **"container build + trusted-local runtime"** birleşimini serbest bırakırdı.

`ST-BACKEND-DOWNGRADE-001` testi yazılırken yakalandı. Doğru kural:

```text
runtime_backend.security_level >= build_backend.security_level
```

Düzeltildi: [ADR-0004](docs/adr/0004-execution-backends.md), `docs/architecture/execution-backends.md`, `docs/MASTER-PLAN.md`, `apps/run-supervisor/src/backend.ts`.

---

## Yapılanlar

| Gün | İçerik |
|---|---|
| 1 | Monorepo yapısı, LICENSE, README, workspace config, uyumluluk profili, MASTER-PLAN + 30'dan fazla konu belgesi |
| 2 | ADR-0001…0007 (+ doğrulama sonrası ADR-0008) |
| 3 | Capability şeması + 34 kayıt, error şeması + 109 kod, paylaşılan JSON Schema'lar, codegen ve 5 doğrulama kapısı |
| 4 | TypeScript workspace (5 paket), Java Bridge iskeleti, CI workflow, issue şablonları |
| 5 | Stateless MCP stdio sunucusu, iki katmanlı stdout guard, Stable Tool Facade, 10 contract testi, Inspector notu |

---

## Giderilen engeller

| Engel | Durum |
|---|---|
| Java 25 kurulu değil | ✅ **Temurin 25.0.4.7 kuruldu**; Gradle toolchain çözüldü |
| Gradle Wrapper yok | ✅ **Üretildi** — checksum'ı doğrulanmış 9.6.1 dağıtımından |
| `distributionSha256Sum` yok | ✅ Eklendi (`9c0f7fae…`) |
| Wrapper JAR checksum'ı kayıtsız | ✅ [`WRAPPER-CHECKSUMS.md`](bridge/paper/gradle/wrapper/WRAPPER-CHECKSUMS.md) (`497c8c2a…`) |
| Dependency lock yok | ✅ `bridge/paper/gradle.lockfile` |
| Verification metadata yok | ✅ 78 modül, SHA-256 — ⚠️ [manuel review bekliyor](bridge/paper/gradle/DEPENDENCY-VERIFICATION.md) |
| `.npmrc` oluşturulamadı | ✅ Yazıldı (`save-exact`, `engine-strict`) |
| **`bridge/paper` hiç derlenmedi** | ✅ **BUILD SUCCESSFUL** — `paper-api` koordinatı gerçekten çözüldü, JUnit 3/3 |

### Bridge derleme kanıtı

```text
> Task :checkGeneratedSources
> Task :compileJava
> Task :test
BUILD SUCCESSFUL

paper-bridge-0.1.0-prototype.0.jar (10 146 bayt)
plugin.yml -> api-version: '26.2'   (profilden token genişlemesi)
BridgeBootTest: tests=3 failures=0 errors=0
```

Bu, uyumluluk profilinin en kritik iddiasını kanıtlar: `io.papermc.paper:paper-api:26.2.build.84-stable` **gerçek bir koordinattır** ve Java 25 ile derlenir.

---

### Node pini güvenlik sürümüne taşındı

`.npmrc` içindeki `engine-strict=true` kuralı zorluyor — uyuşmazlıkta `pnpm install` uyarı vermiyor, **duruyor**:

```text
Your Node version is incompatible.
Expected version: 24.18.0
Got: v24.11.1
```

Karar: profil `24.18.1`'e taşındı ([ADR-0009](docs/adr/0009-node-security-pin.md)). Aynı LTS minor hattında bir güvenlik sürümü; güvenlik doğrulama aracı olan bir ürünün bilinen düzeltmesi olan runtime'a pinli kalması savunulamaz. Aynı minor hattındaki sonraki yamalar için yeni ADR gerekmez.

---

## Kalan engeller

| Engel | Etki | Durum |
|---|---|---|
| ~~**Docker yok**~~ | ~~`SPIKE-EXECUTION-CONTAINER-001` çalıştırılamaz~~ | ✅ Kapandı — Docker Desktop kuruldu; spike kapalı, container build canlı |
| **İlk commit atılmadı** | ~200 dosya staged | Bekliyor |

---

# M0 — Stable Observation (devam ediyor)

## Gün 6 ✅ Paper downloader ve Java toolchain

| Bileşen | Kanıt |
|---|---|
| Downloads Service v3 istemcisi | **Gerçek servise karşı çalıştırıldı**; build 84 STABLE çözüldü |
| Zorunlu User-Agent | Yazılımı tanımlar + iletişim adresi içerir; jenerik UA testi var |
| Checksum doğrulaması | **58.9 MB gerçek Paper JAR indirildi**, SHA-256 profille birebir |
| Bozuk indirme | Diske **yazılmaz** — test edildi |
| Cache girdisi | Her kullanımda **yeniden** doğrulanır — test edildi |
| Java major tespiti | `1.8.0_481` → 8, `25.0.4` → 25; `JAVA_VERSION_MISMATCH` aksiyon önerir |

## Gün 7 ✅ Bridge loopback HTTP

| Bileşen | Kanıt |
|---|---|
| Loopback bind, rastgele port | Dış arayüzde dinlemediği test edilir |
| Bearer token auth | Sabit süreli karşılaştırma; doğru önek yetmez |
| Host/Origin doğrulaması | Origin reddi **auth'tan önce** çalışır |
| Bounded havuz + kuyruk | 4 worker, 32 kuyruk, `BRIDGE_BUSY` |
| Gövde limiti | 262 144 bayt → `BODY_TOO_LARGE` |
| Handshake dosyası | Port taşır, **secret taşımaz**; atomik yazılır, kapanışta silinir |
| Kapanış temizliği | Port serbest + worker thread kalmıyor — test edilir |
| Yönetilen runtime dışında | HTTP yüzeyi **açılmaz** (marker + token + system property şartı) |

## Gün 8 ✅ Read operations, scheduler, event tamponu

| Bileşen | Kanıt |
|---|---|
| Bounded event ring buffer | Boot içi monoton sequence; eşzamanlı append'te çakışma yok |
| Cursor doğrulaması | Süresi geçmiş **ve** gelecekten cursor **reddedilir** — sessizce başa sarmaz |
| Scheduler executor | Timeout'ta görevi **iptal eder**; geç gelen görev hiçbir şey yapmaz (TH-05) |
| Read operations | `server.get_state`, `plugin.list/get`, `world.list/get_block`, `player.get_state` |
| `/v1/query` | Yalnızca salt okuma; `world.set_block` **reddedilir** |
| `/v1/events` | Cursor uyuşmazlığı → 409, limit üst sınıra kırpılır |
| JSON okuyucu | Derinlik/eleman limiti, sondaki fazlalık ve **yinelenen anahtar** reddi |

Yakalanan gerçek hata: `try (exchange)` catch bloklarından önce exchange'i kapatıyordu; hata yanıtları yazılamıyor, istemci EOF görüyordu. 8 test bunu yakaladı.

## Gün 9–10 ✅ M0 dikey dilimi — GERÇEK PAPER

Runtime image kurucusu, süreç başlatıcı, ready gate, Bridge istemcisi ve cleanup yazıldı; **gerçek Paper 26.2 build 84 üzerinde çalıştırıldı**.

### M0 demosu

> "AI istemcisi çalışan disposable Paper runtime'ın sürümünü, plugin'lerini, dünyalarını ve event'lerini okur; hiçbir mutation aracı developer profile'da görünmez."

| Ölçüm | Sonuç |
|---|---|
| Ready gate | **22–27 s** (Paper hazır + Bridge boot_id + PaperBridge enabled) |
| Paper sürümü | `26.2`, TPS 20, MSPT ~31 |
| Plugin listesi | `PaperBridge 0.1.0-prototype.0`, enabled |
| Dünya listesi | 3 dünya (overworld / nether / the_end) |
| Event yakalama | `plugin.enabled`, `server.ready` |
| Yanlış token | **401** |
| `world.set_block` query ucundan | **reddedildi** |
| Developer profilinde mutation aracı | **yok** (testle sabitlendi) |

### Gerçek Paper 5 lifecycle (M0 kabul kriteri)

```text
┌───┬─────────┬──────────┬────────┬──────┬──────────┬───────────┐
│ # │ ready   │ graceful │ forced │ exit │ portFree │ handshake │
├───┼─────────┼──────────┼────────┼──────┼──────────┼───────────┤
│ 1 │ 23338ms │ true     │ false  │ 0    │ true     │ silindi   │
│ 2 │ 23801ms │ true     │ false  │ 0    │ true     │ silindi   │
│ 3 │ 22468ms │ true     │ false  │ 0    │ true     │ silindi   │
│ 4 │ 25403ms │ true     │ false  │ 0    │ true     │ silindi   │
│ 5 │ 26328ms │ true     │ false  │ 0    │ true     │ silindi   │
└───┴─────────┴──────────┴────────┴──────┴──────────┴───────────┘

başarısız lifecycle : 0
benzersiz boot id   : 5 / 5
orphan java process : 0 (önce 0, sonra 0)
```

Force termination hiç gerekmedi; her koşuda graceful stop, port serbest ve handshake dosyası silinmiş.

### Gerçek Paper bulgusu — chunk yükleme

Paper 26.2'de **oyuncu bağlı değilken hiçbir chunk yüklü kalmıyor** (`loaded_chunks: 0`), `spawn-chunk-radius=2` ayarına rağmen. `world.get_block` bilinçli olarak chunk **yükletmediği** için blok okuma `CHUNK_NOT_LOADED` döndürüyor.

Bu, kodun doğru davranışıdır — bir okuma isteğinin dünya üretimi tetiklemesi hem yavaşlar hem "salt okuma" iddiasını bozar. Gerçek çözüm M2A'ya aittir: fixture bölgesi açık **chunk ticket'ı** ile tutulmalıdır. Backlog'a alındı.

### EULA kapısı

Ürün Minecraft EULA'sını **kendiliğinden kabul etmez**: `acceptMinecraftEula` açıkça verilmeden runtime oluşturulamaz ve reddedilen istek hiçbir dosya yaratmaz. Bu koşudaki kabul kullanıcı onayıyla, yalnızca yerel test runtime'ı için verildi.

## M0 kapanışı ✅ Supervisor IPC ve evidence store

### Supervisor IPC

Supervisor **bağımsız** bir process'tir; MCP Server ona bağlanır, onu doğurmaz (ADR-0003). Taşıma: Windows named pipe / POSIX unix socket, NDJSON çerçeveleme.

| Kontrol | Kanıt |
|---|---|
| Token her istekte aranır | Bağlantı başına doğrulama, socket devri hâlinde yetkiyi taşırdı |
| Sabit süreli karşılaştırma | Doğru önek yetmiyor |
| Bilinmeyen metot | `UNKNOWN_TOOL` — serbest komut yüzeyi yok |
| Protokol sürümü | `IPC_VERSION_UNSUPPORTED` |
| Çerçeve boyutu | Satır tamamlanmadan **önce** denetlenir; sonsuz satırla sınır atlatılamaz |

**Uçtan uca doğrulandı:** `runtime.create` → `runtime.launch` → `bridge.query` → `bridge.events` → `runtime.stop` → `runtime.release`, gerçek Paper üzerinde.

### Hata sadakati düzeltmesi

İlk IPC koşusunda mutation reddi `BRIDGE_REQUEST_FAILED` olarak göründü — Bridge'in gerçek kodu sınırda yutulmuştu. Sarmalayıcı kod, `CHUNK_NOT_LOADED` gibi teşhis edici kodları yok ederek KPI-08'i anlamsız kılıyordu.

Düzeltme sonrası, dört sınırı (Bridge HTTP → BridgeClient → Supervisor → IPC) geçen kodlar:

```text
world.set_block   -> TOOL_INPUT_INVALID
world.explode     -> CAPABILITY_UNAVAILABLE
world.get_block   -> CHUNK_NOT_LOADED
plugin.get (arg.) -> TOOL_INPUT_INVALID
```

### Evidence store

Content-addressed (SHA-256), atomik temp+rename, her okumada checksum **yeniden doğrulanır**.

- Aynı içerik aynı nesneye düşer; değiştirilip aynı kimlikle geri konması imkânsız
- Değiştirme **tespit edilir** — ADR-0007'nin tespit/önleme ayrımı korunur
- Token, secret ve IP depoya **ham hâliyle girmez**; kaldırılan alanlar manifestte listelenir
- `redaction.profile` varsayılanı `default-v1`; `none` açıkça istenmelidir (CF-06)

### `system_health` gerçek Supervisor durumunu raporlar

```text
supervisor calisirken : ok        | pid 32864 | java 25 | runtime 0
supervisor olduğunde  : unavailable + "build ve runtime araçları kullanılamaz"
```

Bağlanamama "ok" olarak raporlanmıyor.

### M0 demosu — MCP istemcisinden

```text
tools/list : 13 araç | ttlMs 300000 | cacheScope server
mutation aracı developer profilinde : YOK
known_limitations ajana ulaşıyor    : 3 madde
initialize handshake                : YOK (stateless)
```

### Yakalanan tuzak

`typecheck` script'i `tsc -b --emitDeclarationOnly` kullanıyordu; JS emit edilmediği için `dist/` sessizce bayatlıyor ve testler eski kodu koşuyordu. Script'ler `tsc -b`'ye çevrildi.

## Test toplamı

```text
TypeScript  71  (mcp-server 16, run-supervisor 45, evidence-model 10)
Java        66  (endpoints 20, http 13, ring-buffer 11, dispatcher 9,
                 runtime-context 6, handshake 4, boot 3)
──────────────
toplam     137   + 5 gerçek Paper lifecycle + IPC uçtan uca koşu
```

---

# M1 — Reproducible Build and Launch (devam ediyor)

## ✅ Trust store ve proje kaydı

Araçlar yalnızca `project_id` alır; mutlak path **kabul edilmez** (FS-01, FS-02). Trust kaydı proje klasörünün **içinde** tutulmaz — aksi hâlde projeye yazma yetkisi olan kod kendi trust seviyesini yükseltebilirdi.

| Kontrol | Kanıt |
|---|---|
| Mutlak path | `PATH_OUTSIDE_ROOT` |
| `../` ile kaçış | `PATH_OUTSIDE_ROOT` |
| Ön ek benzerliği (`/a/b` vs `/a/bc`) | Kök altında sayılmaz |
| Symlink/junction proje kökü | `SYMLINK_NOT_ALLOWED` |
| **Yol üzerindeki ara** symlink | `SYMLINK_NOT_ALLOWED` — yalnızca son bileşeni denetlemek yetmez |
| Kayıt sonrası kökün değişmesi | `SYMLINK_NOT_ALLOWED` |
| `untrusted` / `revoked` build | `TRUST_LEVEL_INSUFFICIENT` |
| İzinsiz backend | `TRUST_LEVEL_INSUFFICIENT` |

## ✅ Source snapshot

Deterministik manifest (POSIX yol, boyut, çalıştırılabilirlik biti, SHA-256) ve manifest fingerprint'i. Dizin okuma sırası fingerprint'i etkilemez.

| Davranış | Kanıt |
|---|---|
| Build sırasında değişen dosya | `SOURCE_CHANGED_DURING_BUILD` + **hangi dosya** (`~`, `+`, `-`) |
| Türetilmiş çıktı (`build/`, `.gradle/`) | Snapshot dışında; değişmesi snapshot'ı bozmaz |
| Snapshot içinde symlink | `SYMLINK_NOT_ALLOWED` (SN-04) |
| Kök fingerprint vs manifest fingerprint | Ayrı — aynı içerik farklı projeden gelmiş olabilir |
| Kirli workspace (CI profili) | `DIRTY_WORKSPACE_REJECTED` |

SN-02 sessizce tolere edilmiyor: aksi hâlde rapor, gerçekte derlenmeyen bir kaynak durumuna atıfta bulunur ve KPI-09 anlamsızlaşır.

## ✅ Gradle supply-chain doğrulaması

`project_validate` çekirdeği. **Bulguların tümü** raporlanır; ilk hatada durmak kullanıcıyı aynı projeyi defalarca çalıştırmaya zorlar ve eksik olan diğer kontrolleri gizlerdi.

```text
GRADLE_WRAPPER_NOT_FOUND              GRADLE_VERSION_INCOMPATIBLE
GRADLE_WRAPPER_JAR_UNVERIFIED         DEPENDENCY_LOCK_MISSING
GRADLE_DISTRIBUTION_URL_UNAPPROVED    DEPENDENCY_VERIFICATION_MISSING
GRADLE_DISTRIBUTION_CHECKSUM_MISSING  DYNAMIC_DEPENDENCY_FORBIDDEN
GRADLE_DISTRIBUTION_CHECKSUM_INVALID  CHANGING_MODULE_FORBIDDEN
```

İki incelik: yorum satırındaki örnek bulgu üretmez, ve kapalı `verify-metadata` dosyanın varlığını anlamsız kıldığı için hata sayılır.

**Dogfooding:** kendi `bridge/paper` projemiz bu kuralların tamamından geçiyor — test bunu doğruluyor.

## ✅ Trusted Local backend ve build yürütme

**Bu bir sandbox değildir** ve öyle adlandırılmaz. Sağladığı kontroller:

| Kontrol | Kanıt |
|---|---|
| Shell yok | Argümanlar dizi ile geçer; yol metakarakteri yorumlanmaz |
| Environment allowlist | `GRADLE_OPTS`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS` **aktarılmaz** |
| Host secret | `AWS_SECRET_ACCESS_KEY` gibi değişkenler geçmez |
| Ayrı HOME / TEMP | Kullanıcının ev dizini kirletilmez |
| Timeout | Tüm process tree'ye uygulanır |
| Output limiti | `OUTPUT_LIMIT_EXCEEDED` ile kesilir |
| Ağ politikası | Varsayılan `offline`; ağ açmak **açık onay** ister |

### `gradlew` script'i çalıştırılmaz

Windows'ta `.bat` dosyasını shell olmadan başlatmak mümkün değil; `shell: true` ise proje yolundaki bir metakarakteri komut enjeksiyonuna çevirirdi (PR-01 ihlali).

Çözüm: **checksum'ı doğrulanmış wrapper JAR'ının ana sınıfı** doğrudan Java ile çalıştırılıyor.

```text
<profildeki java> -classpath gradle/wrapper/gradle-wrapper.jar \
    org.gradle.wrapper.GradleWrapperMain --no-daemon --console=plain assemble --offline
```

Üç kazanç: shell yok, doğrulanmamış script metni yok, Java sürümü profille sabit.

## ✅ Build executor ve provenance zinciri

Sıra kısayol kabul etmiyor: trust → backend izni → snapshot → supply-chain → build → **snapshot yeniden doğrulaması** → artifact → provenance.

### Dogfood: kendi Bridge'imiz kendi hattımızdan geçti

```text
1. PROVISIONING (açık onay, ağ AÇIK, TEMİZ cache)   -> 60 s, başarılı
2. REPRODUCIBLE (ağ KAPALI, dolu cache)             -> 3.7 s, başarılı

source_snapshot_id       : src_e6a04491d42def14c2f23f14  (41 dosya)
execution_environment_id : exe_2707e257cb4574b9aa86fffe  trusted-local / offline
build_artifact_id        : bart_967bea6e5e366b1b095f72fc
  artifact_sha256        : 967bea6e...94c68e68   (57 887 bayt)
```

Artifact SHA-256, bağımsız iki koşuda **birebir aynı** çıktı.

## 🔴 Yakalanan supply-chain hatası — sıcak cache metadata'yı eksik üretir

Reproducible mod ilk denemede `--offline` ile bağımlılık çözemedi; bu doğru davranıştı ve eksik olan `prepareDependencyCache` adımını gösterdi. Cache eklendikten sonra **temiz cache** ile provisioning denendi ve gerçek hata ortaya çıktı:

```text
Dependency verification failed for configuration ':compileClasspath'
17 artifacts failed verification:
  - adventure-bom-5.2.0.pom
  - junit-bom-5.13.4.module
  - log4j-bom-2.26.0.pom  ...
```

**Sebep:** `--write-verification-metadata` yalnızca *o an indirilen* artefaktları kaydeder. Cache doluysa POM/BOM metadata dosyaları hiç indirilmez ve kayda girmez. Sonuç: geliştiricinin makinesinde çalışan, temiz makinede düşen bir yapılandırma. Eksiklik **sessizdir**.

Ölçüm: sıcak cache **78** component, soğuk cache **91**. Aradaki 13 dosya ilk temiz build'i düşürüyordu.

**Statik bir sezgi bu hatayı yakalayamaz:** hatalı metadata (78) zaten `gradle.lockfile` modül sayısından (59) fazlaydı, yani "metadata ≥ lockfile" kuralı onu da geçirirdi. Bu yüzden böyle bir kural **eklenmedi**.

**Tek güvenilir koruma temiz makinede build'dir.** CI runner'ı boş cache ile başlar; `pr.yml` içindeki Java işi bu hatayı yakalar. Bu nedenle Gradle cache'i CI'da **bilinçli olarak önbelleğe alınmıyor** — hız kazancı bu hata sınıfını görünmez kılardı.

## ✅ Sınırlı ZIP okuyucu

JAR içinden okuma için bağımlılık **eklenmedi**. Gerekçe: yalnızca birkaç girdi okunuyor ve daha önemlisi, belgelenen arşiv sınırlarını (FS-11, FS-12) gerçekten uygulayabilmek için ayrıştırmanın bizim kontrolümüzde olması gerekiyor.

| Kontrol | Kanıt |
|---|---|
| Traversal (`../`, mutlak yol, sürücü harfi) | `ARCHIVE_ENTRY_OUTSIDE_ROOT` |
| Null bayt | `ARCHIVE_INVALID` |
| Aşırı sıkıştırma oranı | `ARCHIVE_EXPANSION_LIMIT` |
| Girdi sayısı / toplam boyut | `ARCHIVE_EXPANSION_LIMIT` |
| `inflateRaw` çıktı sınırı | Bildirilen `uncompressedSize`'a güvenilmez |

Arşiv **diske açılmaz**; yalnızca central directory üzerinden okunur.

## ✅ plugin.yml doğrulaması

| Kontrol | Kod |
|---|---|
| Metadata yok | `PLUGIN_METADATA_NOT_FOUND` |
| İki manifest birlikte | `PLUGIN_METADATA_AMBIGUOUS` — örtük öncelik kuralı yok |
| `paper-plugin.yml`, flag kapalı | `PAPER_PLUGIN_EXPERIMENTAL_DISABLED` — sessizce yok sayılmaz |
| Main sınıfı JAR'da yok | `PLUGIN_MAIN_CLASS_MISSING` |
| `api-version` eksik / uyumsuz | `PLUGIN_API_VERSION_MISSING` / `..._INCOMPATIBLE` |
| Duplicate ad | `PLUGIN_NAME_CONFLICT` |
| Kendine bağımlılık | `PLUGIN_LOADING_CYCLE` |

YAML `api-version: 26.2` değerini sayı olarak ayrıştırır; okuyucu bunu da doğru çözüyor.

**Dogfood:** gerçek Bridge JAR'ı (40 girdi) doğrulamadan geçiyor.

## ✅ Build kanıtları

Build çıktısı evidence store'a **üç ayrı kanıt** olarak yazılıyor — üç ayrı soruya cevap verdikleri için: "ne oldu" (build log), "neyi düzeltmeliyim" (diagnostics), "ne üretildi" (artifact manifest). Tek birleşik kanıt, byte limitinde kesildiğinde üçünü birden kaybettirirdi.

```text
source_snapshot_id  : src_ed22dec5c967658ad968ba29
build_artifact_id   : bart_967bea6e5e366b1b095f72fc
evidence_ids        : 3 kanıt
  build-log             1177 bayt  redaction=default-v1
  compiler-diagnostics    77 bayt  redaction=default-v1
  artifact-manifest      304 bayt  redaction=default-v1

plugin.yml : GEÇERLİ | PaperBridge 0.1.0-prototype.0 | api-version 26.2 | 40 girdi
```

Kanıt yazma hatası build'i başarısız **saymaz**: derleme başarılıysa kanıt yazma sorunu ana sonucu gizlememelidir (KPI-12 ile aynı ilke). Kanıt üretilmediğinde `evidenceIds: []` olarak görünür, gizlenmez.

Artifact manifest'i **proje köküne göre** yol taşır; mutlak host yolu kanıta girmez.

## Test toplamı

```text
TypeScript 154  (mcp-server 16, run-supervisor 128, evidence-model 10)
Java        66
──────────────
toplam     220   + 5 gerçek Paper lifecycle + IPC uçtan uca + dogfood build
```

## Sırada — M1'in kalanı

- Container execution backend'i tool zincirine bağlamak (build + runtime end-to-end)
- Runtime registry kalıcılığı ve Garbage Collector
- `project_inspect` / `project_validate` / `plugin_build` araçlarının IPC'ye bağlanması
- Build edilen plugin'in disposable runtime'da başlatılması (M1 demosu)

---

# D0C — Architecture Freeze (2026-08-07) ✅ GO

## Kapanan spike'lar ve ADR bağlantıları

| Spike | Sonuç | Bağlandığı |
|---|---|---|
| `SPIKE-EXECUTION-CONTAINER-001` | **closed** — 15 deneyin tamamı beklenen sonucu verdi | ADR-0004 §4 (copy-in build, tar cache seed, swap-off, seed fazı, timeout `rm -f`, Bridge runtime tespiti) |
| `SPIKE-WINDOWS-PROCESS-001` | **closed** — `taskkill /T /F`, 0 orphan; native addon gerekmez | Trusted Local (Windows M1'de destekli) |
| `SPIKE-ACTOR-001` | **closed** — ADR-0006 uyumlu | ADR-0006, M2B koşulu sağlandı |
| `SPIKE-MCP-SDK-2026-001` | **closed** — stable 2.0.0, fakat `2026-07-28` desteklenmiyor | ADR-0002/0008 — kendi transport korunur; SDK geçişi gecikme |
| `SPIKE-PAPER-DOWNLOAD-001` | **closed** — üç profil de canlı kaynaktan doğrulandı | Compatibility profile (hepsi `verified`) |
| `SPIKE-SAME-JVM-THREAT-001` | **closed** — limitation kabul edildi | ADR-0007 — T2 yalnızca Container |

## Donan formatlar (değişiklik ADR gerektirir)

| Öğe | Kilit kanıtı |
|---|---|
| Tool profile'ları | `verify:compatibility` — `paper-26.2-build-84/87/90-v1`, hepsi `verified` |
| Capability registry formatı | `check:registry` — 49 capability, 109 error kodu, 3 profil; `check:schemas` 10 şema |
| State machine'ler | `docs/architecture/state-machines.md` — `UNKNOWN_OUTCOME` ve `DIRTY` semantiği değiştirilemez |

## D0C kararları

1. **GO verildi.** M1 kalan işleri (runtime registry + IPC bağlantısı + container end-to-end) M0'da kanıtlanmış altyapının üzerine biner; yeni risk sınıfı yok.
2. **`world.set_block` debug tool'u eklenmeyecek** — mutation yüzeyi Scenario DSL ile sınırlı (sapma #2 teyidi).
3. **SDK geçişi V1 gate'i olarak açık kalır** — gecikme, engel değil; `mcp.sdk_prototype.linked: false`.
4. **Container deney sonuçları ADR-0004'e işlendi** — çıkış kararı tablosunun ilk satırı geçerli (Container backend M1'de zorunlu default).

## Doğrulama (2026-08-07)

```text
✓ verify:compatibility   üç profil verified (canlı kaynak)
✓ check:registry         49 capability, 109 error kodu, 3 profil
✓ check:schemas          10 şema, 49 kayıt
✓ gen:check              7 generated dosya güncel
✓ check:docs             81 markdown (5 KPI-11 muafiyeti)
✓ check:parse            265 dosya, 33 gömülü kod bloğu
✓ test (run-supervisor)  482/482 + canlı Docker testleri
```

---

## D0A'yı kapatan tek açık madde

**Primary MCP client seçilmedi.** KPI-10 iki ayak ister: Inspector **ve** bir gerçek istemci. Inspector'ın hangi sürümünün `2026-07-28` revizyonunu desteklediği de `SPIKE-MCP-SDK-2026-001` ile belirlenecek.

---

## Kaynak belgeden bilinçli sapmalar

1. **Risk seviyesi türetimi.** Belgedeki tablo salt-okuma `project_inspect`'i R3 yapıyor, bu da ADR-0007'nin "R3/R4 agent-facing olamaz" kuralıyla çakışıyordu. `effect: read` için tavan R1'de tutuldu.

2. **`world.set_block` debug tool'u.** V3'ün capability örneği `minecraft_world_set_block`'u debug tool gösteriyor, fakat aynı belgenin debug profile listesi içermiyor. Profil listesi normatif kabul edildi. **D0C'de teyit edildi (2026-08-07):** debug tool eklenmeyecektir — setup mutation'ları yalnızca Scenario DSL üzerinden yapılır (`world-block-write.yaml` içindeki NOT'a işlendi).

3. **DOC-GATE-06 muafiyet mekanizması.** Fuzzy olumsuzlama kelime listesi meşru metinlerde 5 yanlış pozitif üretti. Listeyi genişletmek yerine greplenebilir `<!-- kpi-11-exempt: neden -->` işareti eklendi; muafiyet sayısı her koşuda raporlanır.

4. **Backend formülü** — yukarıda madde 3.
