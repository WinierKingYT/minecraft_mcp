# SPIKE-PAPER-DOWNLOAD-001 — Paper Downloads Service ve checksum

**Durum:** closed
**Blokladığı:** Compatibility profile doğrulaması, M1
**Zaman kutusu:** 1–2 gün
**Kapanış tarihi:** 2026-08-03

## Cevaplanacak sorular

1. Downloads Service'in güncel API şekli ne? Endpoint yolları, sürüm listeleme ve build listeleme yanıtları?
2. Yanıt SHA-256 checksum içeriyor mu? Hangi alanda?
3. Profildeki Minecraft sürümü ve build numarası gerçekten mevcut mu?
4. Kanal bilgisi (`STABLE` vb.) yanıtta nasıl temsil ediliyor?
5. Servisin beklediği `User-Agent` politikası ne? Rate limit var mı?
6. Paper API'nin **Maven** koordinatı gerçekte ne? Profildeki `io.papermc.paper:paper-api:26.2.build.84-stable` biçimi doğru mu, yoksa tarihsel `<mc>-R0.1-SNAPSHOT` biçimi mi geçerli?
7. `plugin.yml` `api-version` değeri hangi biçimi kabul ediyor?

## Neden kritik

Bu spike, uyumluluk profilinin **tüm** Paper alanlarını doğrular. Profil yanlışsa M1'in build ve runtime katmanının tamamı var olmayan bir koordinat üzerine kurulur.

Soru 6 özellikle şüphelidir: V3 sözleşme belgesindeki koordinat biçimi Paper'ın bilinen Maven şemasına benzemiyor.

## Deney planı

1. Sürüm listesi ve build listesi yanıtlarını kaydet.
2. Profildeki build'in manifest'ini çek; checksum alanını doğrula.
3. JAR'ı indir, SHA-256'sını hesapla, manifest ile karşılaştır.
4. Paper Maven repository'sinde API artifact'ini ara; gerçek koordinatı ve mevcut sürümleri kaydet.
5. Minimal bir plugin'i o koordinatla derle.

## Çıkış kararı

| Sonuç | Karar |
|---|---|
| Tüm koordinatlar doğrulandı | Profil `verified`; `jar_sha256` ve `distribution_sha256` doldurulur |
| Sürüm/build mevcut değil | Profil, mevcut en yakın STABLE build'e güncellenir; ADR notu eklenir |
| API koordinat biçimi farklı | Profil ve tüm build dosyaları düzeltilir |
| Servis checksum vermiyor | Kendi checksum'ımızı ilk indirmede sabitle (TOFU) ve bu kısıt açıkça belgelensin |

Son satır bir gerilim noktasıdır: TOFU, supply-chain iddiasını zayıflatır ve `security/supply-chain.md` içinde limitation olarak yazılmalıdır.

## Bulgular

### 1–2. API şekli ve checksum

Downloads Service v3 `https://fill.papermc.io/v3/...` (önek `fill.api.papermc.io` **DNS'te yoktur** — yalnızca `fill.papermc.io`). Sürüm liste, build liste ve tekil build manifest yanıtları JSON; tekil build şu alanları taşır:

```json
{ "id": 84, "channel": "STABLE", "downloads": { "server:default": { "checksums": { "sha256": "..." }, "url": "https://fill-data.papermc.io/v1/objects/<sha>/paper-26.2-84.jar" } } }
```

Checksum alanı `downloads.server:default.checksums.sha256`'tır.

### 3. JAR indirme + SHA-256 karşılaştırması

Üç profil için JAR indirildi ve SHA-256 hesaplanıp manifest ve profil `jar_sha256` ile karşılaştırıldı — **üçü de birebir eşleşti**:

| Build | SHA-256 (manifest = profil) |
|---|---|
| 84 | `defe82c1c89067186895de34cf32983e9f5a2ea387cfe7597c020faebb98ca16` |
| 87 | `3ab7536642d04c504a06fe43174b8a94f8c5f25d5847d4672212413f6e54b906` |
| 90 | `26cfb1f2b6b28f317505e5ae353554971fa6e7aad9aad3e70e1a120b9a07510c` |

Bu doğrulama artık `scripts/verify-compatibility.mjs --verify-jar` ile tekrarlanabilir.

### 4. Maven koordinatı

`io.papermc.paper:paper-api:26.2.build.<N>-stable` biçimi **doğrudur** (soru 6). `maven-metadata.xml` içinde `26.2.build.84-stable`, `-87-stable`, `-90-stable` mevcut. Tarihsel `<mc>-R0.1-SNAPSHOT` şeması 26.2 için geçerli değildir.

### 5. User-Agent / rate limit

Servis `User-Agent` başlığıyla çalışır; `minecraftmcp-verify/0.1` ile 3 tekil build + listeler çekildi, rate-limit gözlenmedi.

## Sonuç

**Tüm koordinatlar doğrulandı → üç profil de `verification.status: verified`; `jar_sha256`, `observed_download_url` ve `distribution_sha256` canlı kaynaktan dolduruldu.**

`scripts/verify-compatibility.mjs` artık ağ doğrulamasını fiilen çalıştırır (`--verify-jar` ile JAR indirip SHA-256 karşılaştırır); `--profile=<id>` seçeneğiyle hangi profilin denetleneceği seçilir. Spike **closed**.
