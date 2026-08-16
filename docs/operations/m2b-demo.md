# M2B actor → canlı Paper demo

M2B dikey dilim: **protocol actor'ların gerçek Paper'da NMS ile dünyaya join olması** — `test_actor.create` (offline identity ile gerçek protokol istemcisi), oyuncu bağlamında komut/mesaj/hareket, native permission semantiği ve crash cleanup. Akış, `scenario_run` araç yüzeyiyle aynı kod yolundan geçer (`NmsActorHandler` + `ScenarioEngine` DSL-10 cleanup).

Bu akış **gerçek Gradle build ve gerçek Paper** başlatır; normal `pnpm run check` içinde koşmaz (tüm M2B kapanış testleri mock-bridge engine testleridir — `m2b-actor-scenarios.test.ts`, CI'da koşar):

1. Minecraft EULA kabulü gerektirir — kullanıcı kararıdır.
2. ~60 MB Paper JAR, dünya üretimi ve (container backend'de) Docker imajı ister.
3. `JAVA_HOME` profildeki major'a (Java 25) işaret etmelidir; yoksa Gradle 21 bulur ve build reddedilir.
4. Actor NMS join'i, oyuncusuz sunucuda dünya/chunk yüklenmesini tetikler — `requires: world.chunk.ticket` olan scenario'lar `given`'da ticket ister.

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

Bayat bridge JAR en sık yaşanan canlı hatadır: JAR'da actor op/event yoksa `test_actor.*` / `player.*` adımları bilinmeyen action ile reddedilir. Her bridge değişikliğinden sonra jar yeniden derlenmeli.

## Çalıştırma

M2B senaryoları, M2A demo akışındaki aynı `service.scenarioRun` kod yolundan geçer. `runM2ADemo`'ya `scenarioFiles` verilirse varsayılan world/smoke listesi yerine `scenarios/actor/*.yaml` dosyaları koşulur. `acceptMinecraftEula` alanı **açıkça** istenir; `backend` verilmezse `trusted-local` denenir:

```bash
node --input-type=module -e "import {runM2ADemo} from './apps/run-supervisor/dist/src/m2a-demo.js'; console.log(await runM2ADemo({repoRoot:process.cwd(), profileId:'paper-26.2-build-84-v1', bridgeJarPath:'./bridge/paper/build/libs/paper-bridge-0.1.0-prototype.0.jar', paperCacheDir:'./.cache/paper', projectId:'minimal-paper-plugin', projectRoot:'./fixtures/projects/minimal-paper-plugin', acceptMinecraftEula:true, backend:'trusted-local', scenarioFiles:['scenarios/actor/lifecycle.yaml','scenarios/actor/block-break.yaml','scenarios/actor/native-permission.yaml'], reportDir:'./.mcpdev-data/reports', exitWhenDone:true, log:(m)=>console.log(m)}))"
```

`runM2BDemo` diye ayrı bir giriş noktası yoktur; M2B, M2A demo'nun `scenarioFiles` parametresiyle koşulur.

## Akış

```text
runtime.create {buildId} -> runtime.launch -> READY gate (bridge boots)
  -> scenario_run (scenarios/actor/lifecycle.yaml):
    given: test_actor.create (NMS join, offline identity)
    when:  player.get_state -> player.look north -> player.move (0,64,0)
           -> player.chat "merhaba m2b" -> test_actor.disconnect_all
    then:  assert.player_state connected:false
           -> assert.player_message contains "merhaba" (ring buffer)
           -> assert.event player.chat
  -> runtime.stop -> runtime.release {discardImmediately: true}
    -> GC taraması: runtimeRootDir kalıntısız + kalan oyuncu yok
```

## M2B acceptance eşlemesi

| Acceptance | Canlı kanıt |
|---|---|
| Actor 100 lifecycle | 100 `test_actor.create` + `disconnect_all`; tümü connected → tümü bağlantısız |
| Join/quit | lifecycle.yaml: create → get_state → disconnect → `connected: false` |
| Command | `plugin.command` oyuncu bağlamında dispatch edilir |
| Permission | native-permission.yaml: yetkisiz `gamemode` → `dispatch_ok=false` (ADR-0006) |
| Block interaction | block-break.yaml: `player.break_block` → blok air + `block.break` event'i |
| Message capture | `assert.player_message` ring buffer'dan `player.message` eşleşmesi |
| Actor crash cleanup | DSL-10: `when` fazında ACTOR_CRASHED olsa da `test_actor.disconnect_all` koşar |

## DSL-10 cleanup (engine düzeltmesi)

`scenario-engine.ts` `#runCleanup` — cleanup artık **her terminal durumda** denenir: given/when hatası, assertion hatası veya engine hatası. Cleanup adımının kendisi başarısız olursa bu, ana scenario sonucunu gizlemez (KPI-12). Crash doğrulaması: `when` içinde `plugin.command` başarısız olur → `ACTOR_CRASHED` → engine yine de cleanup fazını koşturur ve `test_actor.disconnect_all` çağrılır (mock-bridge testi `m2b-actor-scenarios.test.ts`, CI'da).

## Bilinen sınırlar

- `test_actor` ile join, oyuncusuz sunucuda spawn chunk'ı zorlar; mutasyon scenario'ları chunk ticket ile çalışır.
- Bridge `plugin.command` unauthorized'da `dispatch_ok=false` döner ama `player.command` event'ini yazar (girişim kayıt altındadır) — bu, "geçen ama yanlış test"i engeller (ADR-0006).
- Actor'lar test identity taşır; production credential veya gerçek hesap yok (capability `test_actor.protocol` — R1, disposable_runtime).
- EULA akışı: `mcpdev eula accept` operatör yüzeyinden (`../operations/mcp-eula-check.md`).
