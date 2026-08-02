# M0 gerçek Paper smoke

Bu akış **gerçek Paper** başlatır ve normal `pnpm run check` içinde koşmaz. Nedeni iki tanedir:

1. Minecraft EULA kabulü gerektirir — bu bir kullanıcı kararıdır, ürün kendiliğinden vermez.
2. ~60 MB Paper JAR indirir ve dünya üretir; PR başına koşacak bir iş değildir.

Nightly gerçek-Paper işine bağlanacaktır.

## Ön koşullar

| Gereksinim | Kaynak |
|---|---|
| Java (profildeki major) | `java.runtime_major` |
| Bridge JAR | `bridge/paper/build/libs/paper-bridge-*.jar` |
| Ağ erişimi | PaperMC Downloads Service |
| EULA kabulü | Kullanıcı |

```bash
cd bridge/paper && ./gradlew build
```

```bash
pnpm --filter @mcpdev/run-supervisor exec tsc -b
```

## Çalıştırma

`runM0Smoke` çağrısı `acceptMinecraftEula` alanını **açıkça** ister. `false` verildiğinde `EULA_NOT_ACCEPTED` üretilir ve **hiçbir dosya oluşturulmaz**.

```bash
node --input-type=module -e "import {runM0Smoke} from './apps/run-supervisor/dist/src/m0-smoke.js'; console.log(await runM0Smoke({repoRoot:process.cwd(), profileId:'paper-26.2-build-84-v1', bridgeJarPath:'./bridge/paper/build/libs/paper-bridge-0.1.0-prototype.0.jar', paperCacheDir:'./.cache/paper', acceptMinecraftEula:true}))"
```

## Akış

```text
uyumluluk profili -> java toolchain -> Downloads Service çözümleme
  -> JAR indirme + checksum -> runtime image (marker, token, config, Bridge)
    -> Paper başlatma -> READY GATE -> gözlem -> negatif kanıtlar
      -> graceful stop -> port/handshake doğrulaması
```

## Ready gate üç şart arar

"Process ayakta" **yetmez**:

1. Bridge handshake dosyası yazıldı ve `server_instance_id` eşleşiyor
2. `/v1/health` yanıt veriyor ve `bridge_boot_id` handshake ile aynı
3. `plugin.list` içinde `PaperBridge` **enabled**

Üçü de sağlanmazsa `READY_GATE_FAILED` veya `STARTUP_TIMEOUT` üretilir ve process force kill edilir.

## Üretilen kanıt

`SmokeEvidence` şunları taşır: runtime image kimliği, boot kimliği, Paper/Bridge JAR checksum'ları, ready gate süresi, health/capabilities/server state/plugin/world/event çıktıları, **negatif kanıtlar** (yanlış token → 401, mutation reddi) ve cleanup sonucu.

Cleanup sonucu ana sonuçtan **ayrıdır** (KPI-12): `graceful`, `forceTerminated`, `exitCode`, `portReleased`, `handshakeRemoved`.

## Ölçülmüş sonuçlar

Paper 26.2 build 84, Java 25, Windows 11 — 5 ardışık lifecycle:

| Ölçüm | Değer |
|---|---|
| Ready gate | 22–27 s |
| Graceful stop | 5/5 |
| Force termination | 0/5 |
| Port serbest | 5/5 |
| Handshake silindi | 5/5 |
| Orphan java process | 0 |

## Bilinen sınır — chunk yükleme

Paper 26.2'de oyuncu bağlı değilken `loaded_chunks` 0 kalır. `world.get_block` chunk **yükletmez**, bu yüzden `CHUNK_NOT_LOADED` döner.

Bu bilinçlidir: bir okuma isteğinin dünya üretimi tetiklemesi hem yavaşlar hem "salt okuma" iddiasını bozar. Deterministik blok assertion'ları için fixture bölgesi M2A'da açık chunk ticket'ı ile tutulacaktır — bkz. [`../contracts/determinism.md`](../contracts/determinism.md).
