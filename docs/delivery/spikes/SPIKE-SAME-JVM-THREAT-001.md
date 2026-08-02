# SPIKE-SAME-JVM-THREAT-001 — Same-JVM tehdit sınırı

**Durum:** open
**Blokladığı:** ADR-0007, `security/guarantees.md`
**Zaman kutusu:** 2–3 gün

## Amaç

Bu spike bir kontrol *eklemek* için değil, kabul edilen limitation'ın **gerçek sınırlarını ölçmek** içindir. Çıktısı kod değil, doğru ifade edilmiş bir limitation cümlesi ve iki regression testidir.

## Cevaplanacak sorular

1. Aynı Paper JVM'inde çalışan bir hedef plugin, Bridge'in token'ına hangi yollarla ulaşabilir?
   - environment variable
   - system property
   - runtime dizinindeki dosyalar
   - classloader üzerinden Bridge sınıflarına reflection
   - açık loopback port'un taranması
2. Bu yollardan hangileri makul maliyetle **daraltılabilir** (örn. token'ı bellekte tutmak, dosyaya hiç yazmamak, `SecurityManager` yerine sınıf erişim düzeni)?
3. Hedef plugin, Bridge'in ürettiği evidence dosyalarını değiştirebilir mi? Checksum host tarafında hesaplanıyorsa tespit edilebilir mi?
4. Hedef plugin, event ring buffer'ına sahte event enjekte edebilir mi?
5. Hedef plugin, Bridge'in scheduler görevlerini bloke ederek scenario'yu timeout'a sürükleyebilir mi? Bu bir DoS olarak kabul edilip `UNKNOWN_OUTCOME` ile mi raporlanmalı?
6. Java 25'te plugin'in reflection ile Bridge internals'a erişimini kısıtlayan modül/erişim mekanizmaları pratikte uygulanabilir mi?

## Deney planı

Kötü niyetli fixture plugin'i yaz (`fixtures/plugins/hostile-probe/`) ve şunları denesin:

1. Token arama (env, property, dosya sistemi, reflection).
2. Bridge endpoint'ine yetkisiz istek.
3. Evidence dosyası değiştirme.
4. Sahte event üretme.
5. Main thread'i bloke etme.

Her deneme için sonuç: **başarılı / engellendi / tespit edildi**.

## Çıkış kararı

| Sonuç | Karar |
|---|---|
| Token erişimi daraltılabiliyor | Daraltmayı uygula; limitation cümlesi kalır ama kapsamı küçülür |
| Evidence değişikliği tespit edilebiliyor | `integrity.sha256` host tarafında hesaplanır; bu bir **tespit** garantisi olarak yazılır, **önleme** olarak değil |
| Sahte event enjekte edilebiliyor | Event `source` alanı ve causation zinciri ile ayrıştırılır; limitation'a eklenir |
| Hiçbiri daraltılamıyor | Limitation olduğu gibi kalır; T2 için Container zorunluluğu güçlendirilir |

## Yasak sonuç

Bu spike'ın sonucu **hiçbir koşulda** "same-JVM auth artık güvenlik sınırıdır" olamaz. Bu, [`../beyond-v1.md`](../beyond-v1.md) içindeki yasak genişleme biçimlerinden biridir.

## Bulgular

_(spike sırasında doldurulur)_

## Sonuç

_(limitation cümlesinin nihai metni + `ST-SAMEJVM-001/002` testlerinin tanımı)_
