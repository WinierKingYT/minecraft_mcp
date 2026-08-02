# SPIKE-PAPER-DOWNLOAD-001 — Paper Downloads Service ve checksum

**Durum:** open
**Blokladığı:** Compatibility profile doğrulaması, M1
**Zaman kutusu:** 1–2 gün

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

_(spike sırasında doldurulur)_

## Sonuç

_(bir cümlelik karar + profil güncellemesi)_
