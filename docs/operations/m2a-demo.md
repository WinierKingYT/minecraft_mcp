# M2A scenario → canlı Paper demo

M2A dikey dilim: **ScenarioEngine'in disposable runtime zincirine bağlanması** — YAML scenario dosyası → runtime provisioning (build + launch) → günlük adım eşlemesi → assertion'lar → runtime dispose + GC. Akış, MCP araçlarının IPC üzerinden çağırdığı handler'ların (`SupervisorService.handlers()`) birebir aynısını kullanır — `scenario_run` araç yüzeyiyle aynı kod yolundan geçer.

Bu akış **gerçek Gradle build ve gerçek Paper** başlatır; normal `pnpm run check` içinde koşmaz:

1. Minecraft EULA kabulü gerektirir — kullanıcı kararıdır.
2. ~60 MB Paper JAR, dünya üretimi ve (container backend'de) Docker imajı ister.
3. `JAVA_HOME` profildeki major'a (Java 25) işaret etmelidir; yoksa Gradle 21 bulur ve build reddedilir.

## Ön koşullar

| Gereksinim | Kaynak |
|---|---|
| Java 25 + `JAVA_HOME` env | `C:\Program Files\Eclipse Adoptium\jdk-25.0.4.7-hotspot` |
| Bridge JAR (güncel!) | `bridge/paper/build/libs/paper-bridge-*.jar` |
| Host Gradle cache (offline build için seed) | `~/.gradle` (wrapper dists + modules-2) |
| EULA kabulü | Kullanıcı |

```bash
cd bridge/paper && ./gradlew jar --console=plain
corepack pnpm --filter=@mcpdev/run-supervisor run build
```

Bayat bridge JAR en sık yaşanan canlı hatadır: JAR'da yeni mutation/event yoksa scenario adımları bilinmeyen action ile reddedilir. Her bridge değişikliğinden sonra jar yeniden derlenmeli.

## Çalıştırma

`runM2ADemo` çağrısı `acceptMinecraftEula` alanını **açıkça** ister. `backend` verilmezse `trusted-local` denenir. `--plugin` verilirse fixture build (offline, seed cache) koşulur ve `plugin-enables` scenario'su build id ile çalıştırılır:

```bash
node --input-type=module -e "import {runM2ADemo} from './apps/run-supervisor/dist/src/m2a-demo.js'; console.log(await runM2ADemo({repoRoot:process.cwd(), profileId:'paper-26.2-build-84-v1', bridgeJarPath:'./bridge/paper/build/libs/paper-bridge-0.1.0-prototype.0.jar', paperCacheDir:'./.cache/paper', acceptMinecraftEula:true, backend:'trusted-local', withPluginScenario:true, errorScenarios:true, reportDir:'./.mcpdev-data/reports', exitWhenDone:true, log:(m)=>console.log(m)}))"
```

`reportDir` verilirse tüm scenario'lar bittikten sonra üç rapor formatı tek `report_id` ile üretilir (JSON · Markdown · JUnit XML, `scenario-report.ts`). Raporda mutlak host path bulunmaz; `scenario_path` repo köküne göre görelidir.

## Akış

```text
(buildId verildiyse) build.run (offline, trusted-local)
  -> runtime.create {buildId} -> runtime.launch -> READY gate (bridge boots)
    -> scenario_run: given/when/then adım eşlemesi (YAML -> BridgeOperation)
      -> world.set_chunk_ticket (idempotency anahtarlı) -> world.set_block / world.get_block
      -> assert.block / assert.server_state (polling) / assert.event / assert.no_log
        -> runtime.stop -> runtime.release {discardImmediately: true}
          -> GC taraması: runtimeRootDir kalıntısız
```

## Scenario determinizmi

Canlı Paper'dan öğrenilen kural: **oyuncusuz dünyada hiçbir chunk yüklü kalmaz** (spawn chunk dahil). Dünya mutasyonu yapan scenario'lar:

- `requires: world.chunk.ticket` + `given` adımında `world.set_chunk_ticket` (çap 1-4 blok) içermelidir;
- hedef konum, `world.chunk.ticket` capability'sinin izin verdiği radius sınırı içinde olmalıdır.

Aksi halde `CHUNK_NOT_LOADED` ile `world.set_block`/`world.get_block` reddedilir.

## Assertion'ların event cursor'u

Bridge event ring buffer'ı boot'a özgüdür ve sequence 1'den başlar; `plugin.enabled` gibi olaylar boot sırasında, engine `then` fazından önce oluşur. `assert.event` cursor'u ilerletmez — her poll ring buffer'ın en eski korunan event'inden okur. Cursor'u "okunan kadar atla" mantığıyla kurmak boot olaylarını kaçırır (canlı bulgu: `plugin.enabled` timeout'u, düzeltme: buffer başından arama).

## Ölçülmüş sonuçlar

Paper 26.2 build 84, Java 25 (Temurin 25.0.4.7), Windows 11, trusted-local, aynı fixture'la 6 scenario (build dahil tek koşu):

| Ölçüm | Değer |
|---|---|
| Build (offline, seed cache) | ~13.9 s, sha256 `4a82aae89b102682...` |
| read-block (3 adım: given/when/then) | 3/3, ~22.9 s |
| chunk-ticket (ticket + set_block + assert) | 3/3, ~32.8 s |
| plugin-enables (assert.event + assert.no_log) | 2/2, ~27.8 s |
| config: region-not-allowed (DSL-12) | completed, `REGION_NOT_ALLOWED` ~22.3 s |
| config: material-not-allowed (DSL-12) | completed, `MATERIAL_NOT_ALLOWED` ~23.3 s |
| config: chunk-not-loaded (DSL-12) | completed, `CHUNK_NOT_LOADED` ~23.0 s |
| Runtime READY gate | ~24-28 s |
| GC kalıntı | 0 (gcSwept=true) |

Başarı scenario'larında 8/8 assertion, config scenario'larında 3/3 beklenen hata kodu birebir eşleşti (`scenario.expect_satisfied` logu expected/actual ikilisini taşır). `scenario.engine_completed` kanıtları demo logunda.

Evidence provenance (`rep_8a3fbdba29a3913e7a768353` koşusu): 6 scenario 11 kanıt üretti (her run 1 run-level + her assertion 1 assertion-level), örnek okuma-doğrulaması geçti (`ev_31073041b411eb3cd781570d`, kind=assertion-result, sha256 `bd8641298832cee1...`, 2148 byte). Manifest producer'ı `serverInstanceId` (rimg_...) + `bridgeBootId` (boot_...) taşır; rapor her scenario için `evidence_ids` içerir. Store `.mcpdev-data/evidence/<runId>/` altında (gitignore'lu), content-addressed (checksum doğrulamalı okuma).

Rapor ölçümü (JSON/Markdown/JUnit): `rep_c467f99202f86d214363f7c0` — özet `total=6 passed=6 duration_ms=139254`, her scenario kendi `scenario_run_id` + adım/kanıt sayısıyla; Markdown tablosu ve JUnit XML aynı `report_id`'yi taşır.

## Bilinen sınırlar

- `evidence_ids` artık dolu: demo evidence store'u `.mcpdev-data/evidence/<runId>/` altında yapılandırır; scenario başına run-level + assertion-level kanıt yazılır.
- `scenario_assertion_event` history'ye eklendi ama MCP araç yüzeyinde assertion event görünürlüğü sonraki adıma kaldı.

**Assertion görünürlüğü (MCP araç yüzeyi):** `scenario_run` dönüşü her assertion için `step_name/passed/message/duration_ms/attempts/expected/actual` taşır. Canlı örnekler (`rep_1efd8e0c7b7c80be236ec7a8` koşusu): `assert.block` → `expected="minecraft:chest" actual="minecraft:chest"`, `assert.event` → `actual` tam event nesnesi (`sequence:1, type:"plugin.enabled"`), `assert.no_log` → `expected=0 actual=0`. Poll deneme sayısı `attempts` alanında; config error scenario'larında `then` boş olduğundan `assertions=0`.
- 20x determinism koşusu kapsam dışıdır (roadmap M2A).
- Config error scenario'ları canlı koşumda `--errors` bayrağı ile; aksi halde default akış 3 scenario koşar.
- CLI argümanlarıyla `node dist/...` çağrısı Start-Process quoting'inde sorun çıkarır; driver temp `.mjs` dosyalarından `runM2ADemo` çağrılır.

**EULA akışı (operator yüzeyi):** kabul `mcpdev eula accept` ile yapılır (`~/.mcpdev/config/eula.json`); supervisor `--eula-file` (veya serve default'u) ile okur, araç parametresi yok. Kabul yoksa `EULA_NOT_ACCEPTED` (error catalog `runtime.yaml`; `retryable=false`, `suggested_action` → `mcpdev eula accept`; runtime dizini oluşmaz, kanıt yok), kabul varsa gerçek Paper koşusu `completed` + `evidence_ids` + `assertions[]`. Demo scriptleri `eulaAccepted: true` service opsiyonuyla operatör onayını simüle eder. Detaylar: [`../operations/mcp-eula-check.md`](../operations/mcp-eula-check.md).
