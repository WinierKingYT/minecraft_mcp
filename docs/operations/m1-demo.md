# M1 build → launch demo

> **Standalone paket:** uçtan uca `mcpdev` akışı (install → eula → serve →
> `config <client>`) [`install.md`](install.md) standalone bölümünde; bu dosya
> repo içi driver yüzeyini belgeler.

M1 dikey dilim: **build edilen plugin'in disposable runtime'da başlatılması**.
Akış, MCP araçlarının IPC üzerinden çağırdığı handler'ların (`SupervisorService.handlers()`) birebir aynısını kullanır — `build_id` → `plugin_launch` zinciri araç yüzeyiyle aynı kod yolundan geçer.

Bu akış **gerçek Gradle build ve gerçek Paper** başlatır; normal `pnpm run check` içinde koşmaz:

1. Minecraft EULA kabulü gerektirir — kullanıcı kararıdır.
2. ~60 MB Paper JAR, dünya üretimi ve (container backend'de) Docker imajı ister.

Nightly gerçek-Paper işine bağlanacaktır.

## Ön koşullar

| Gereksinim | Kaynak |
|---|---|
| Java (profildeki major, Java 25) | `java.runtime_major` |
| Bridge JAR | `bridge/paper/build/libs/paper-bridge-*.jar` |
| Docker (yalnızca `container` backend) | `eclipse-temurin:25-jdk` imajı |
| Host Gradle cache (offline build için seed) | `~/.gradle` (wrapper dists + modules-2) |
| EULA kabulü | Kullanıcı |

```bash
cd bridge/paper && ./gradlew build
corepack pnpm --filter=@mcpdev/run-supervisor run build
```

## Çalıştırma

`runM1Demo` çağrısı `acceptMinecraftEula` alanını **açıkça** ister. `backend` verilmezse `container` denenir; Docker yoksa `trusted-local`'e düşülür.

```bash
node --input-type=module -e "import {runM1Demo} from './apps/run-supervisor/dist/src/m1-demo.js'; console.log(await runM1Demo({repoRoot:process.cwd(), profileId:'paper-26.2-build-84-v1', bridgeJarPath:'./bridge/paper/build/libs/paper-bridge-0.1.0-prototype.0.jar', paperCacheDir:'./.cache/paper', projectId:'minimal-paper-plugin', projectRoot:'./fixtures/projects/minimal-paper-plugin', acceptMinecraftEula:true, backend:'container', exitWhenDone:true, log:(m)=>console.log(m)}))"
```

## Akış

```text
proje kaydı (approved-fixture) -> build.run (offline, backend seçimi)
  -> build_id + artifact (kalıcı depoya kopya, sha256 yeniden doğrulanır)
    -> runtime.create {build_id} -> artifact çözümleme (BuildRegistry)
      -> runtime.launch -> READY gate
        -> bridge.query plugin.list -> build edilen plugin etkin mi
          -> plugin.diagnose {runtimeId}
            -> runtime.stop -> runtime.release {discardImmediately}
              -> GC taraması: runtimeRootDir kalıntısız
```

## Build artifact kalıcılığı

Container build'leri geçici çalışma dizininde üretilir; executor temizliği o dizini siler. Artifact'lar `artifactStoreDir`'e (`<repoRoot>/.mcpdev-data/artifacts/<buildId>/`) kopyalanır ve **kopya üzerinde sha256 yeniden hesaplanır**. `runtime.create` yalnızca build kaydından çözümler (FS-03: mutlak path kabul edilmez) ve dosyayı yeniden hash'ler; değişmişse `ARTIFACT_INTEGRITY_MISMATCH` üretir.

## Offline build için cache seed

`--network none` ile çalışan container backend ve izole `GRADLE_USER_HOME` kullanan trusted-local backend, bağımlılıkları yalnızca seed'lenmiş cache üzerinden çözer. `runM1Demo` host `~/.gradle`'ın yalnızca `wrapper/dists` ve `caches/modules-2` alt dizinlerini kopyalar (credential/properties taşıyan dosyalar kapsam dışıdır). Kalıcı provisioning (cache'i dolduran onaylı workflow) M1B kapsamındadır; araç yüzeyinde `network: online` açık onay olmadan `PROVISIONING_APPROVAL_REQUIRED` üretir.

## Ölçülmüş sonuçlar

Paper 26.2 build 84, Java 25 (Temurin 25.0.4.7), Windows 11 — aynı fixture'la iki backend:

| Ölçüm | trusted-local | container |
|---|---|---|
| Build | ~13.7 s (offline, seed cache) | ~0 s (sıcak, build completed) |
| Artifact sha256 | `4a82aae89b102682...` | `4a82aae89b102682...` (birebir aynı) |
| Ready gate | ~24 s | ~28 s |
| MinimalPlugin etkin | 2/2 | 2/2 |
| Graceful stop | 1/1 | 1/1 |
| GC kalıntı | 0 | 0 |

İki backend'in aynı sha256 üretmesi reproducible build hedefinin ilk canlı kanıtıdır.

## Bilinen sınırlar

- `plugin_diagnose` runtime dalı şu an durum makinesi + `launchError` + ready gate ile özet üretir; bridge üzerinden plugin bazlı teşhis M2A.
- Artifact deposu retention'ı henüz yok; temizlik M2B.
- `exitWhenDone` yalnızca CLI kullanımı içindir: GC tarayıcı interval'i event loop'u canlı tutar, demo bittiğinde süreç kendiliğinden çıkmaz.
