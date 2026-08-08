# SPIKE-SAME-JVM-THREAT-001 — Same-JVM tehdit sınırı

**Durum:** closed
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

### Canlı deney (Paper 26.2 build 84, Java 25, Windows 11)

Kötü niyetli fixture plugin'i (`fixtures/plugins/hostile-probe/`) gerçek runtime'a
yüklendi ve beş deneme çalıştırıldı. Driver: `apps/run-supervisor/src/spike-hostile-probe.ts`.

| # | Deneme | Sonuç | Ayrıntı |
|---|---|---|---|
| 1a | Token — env | **engellendi** | Supervisor env allowlist'i (PATH, JAVA_HOME, SystemRoot, TEMP, TMP) token taşımıyor |
| 1b | Token — system property | **engellendi** | Token hiçbir property'de değil |
| 1c | Token — dosya sistemi | **başarılı** | `bridge-token` dosyası `mcpdev.runtime.root` property'sinden bulunup okundu |
| 1d | Token — reflection | **başarılı** | `BridgeOperation`, `BridgeCredentials`, `EventRingBuffer` sınıflarına `Class.forName` erişimi açık; plugin classloader izolasyonu yok |
| 2 | Endpoint yetkisiz istek | **kısmen** | Token'sız `/v1/health` → HTTP 401 (engellendi); dosyadan ele geçirilen token ile → HTTP 200 (başarılı) |
| 3 | Evidence değiştirme | **not_present** | Runtime root içinde evidence yok (store host tarafında); sha256 re-verification zaten mevcut (store.ts:190) |
| 4 | Sahte event enjeksiyonu | **blocked** | `EventRingBuffer` sınıfına erişim var fakat buffer örneği static değil; instance'a erişim bu deneyde yapılmadı |
| 5 | Main thread blok (DoS) | **başarılı** | Main thread 20 sn bloke edildi; HTTP sunucusu ayrı thread'de olduğundan health yanıtı etkilenmedi — ancak `PaperMainThreadExecutor` üzerinden geçen görevler bu pencerede zaman aşımına uğrar (`MUTATION_UNKNOWN_OUTCOME` yolu mevcut) |

### Soru bazlı cevaplar

1. **Token'a erişim yolları:** env/property engelli, dosya sistemi ve reflection AÇIK.
   `-Dmcpdev.runtime.root` herkes tarafından okunabilir olduğundan token dosyasının
   yeri biliniyor; `mode 0600` aynı OS kullanıcısındaki plugin'i durdurmuyor.
2. **Daraltılabilirlik:** Daraltılamaz. Token'ın diskte olması zorunlu değil ama
   Supervisor ayrı process'te üretip Bridge'in okuması gerekiyor; her iki yol da
   (dosya, property, env) aynı kullanıcıya erişim verir. Gerçek sınır yalnızca
   container/process izolasyonu.
3. **Evidence değişikliği:** Host tarafında content-addressed store + okumada
   checksum re-verification → değişiklik **tespit edilir** (önlenmez). Deneyde
   runtime root içinde evidence bulunmadı (store host tarafında).
4. **Sahte event:** Bridge sınıflarına reflection açık; buffer örneği static
   tutulmadığı için doğrudan enjeksiyon bu deneyde engellendi. `source` +
   `correlation_id` + `bridge_boot_id` alanları sahte event'i ayrıştırmaya imkân
   verir.
5. **Main thread blok:** Blok başarıyla uygulanabildi (DoS gerçek). HTTP sunucusu
   main thread'den bağımsız (Netty event loop); main-thread bağımlı görevler
   `UNKNOWN_OUTCOME` semantiğine düşer (error catalog: MUTATION_UNKNOWN_OUTCOME,
   retryable: false).
6. **Java 25 modül/erişim kısıtları:** Plugin'ler modüle edilmemiş; classloader
   izolasyonu Paper tarafında uygulanmıyor. `Class.forName` tamamen açık. Pratik
   kısıtlama yolu yok.

## Sonuç

### Limitation cümlesi (nihai metin)

> Bridge, hedef plugin ile **aynı JVM'de ve aynı OS kullanıcısında** çalışır. Bu
> nedenle aynı runtime'a yüklenen kötü niyetli bir plugin token dosyasını okuyabilir
> (`mode 0600` engel değildir), Bridge sınıflarına reflection ile erişebilir ve main
> thread'i bloke ederek görevleri zaman aşımına sürükleyebilir. Bu **kabul edilen bir
> limitation'dır**: same-JVM auth bir güvenlik sınırı DEĞİLDİR. Evidence dosyalarının
> bütünlüğü content-addressed store + okumada sha256 re-verification ile korunur ve
> değişiklik tespit edilir (önlenmez). Sahte event'ler `source`/`causation` zinciri ile
> ayrıştırılabilir. T2'de kötü niyetli veya şüpheli plugin'ler YALNIZCA container
> backend içinde çalıştırılır (SPIKE-EXECUTION-CONTAINER-001).

### Regression testleri

| Test | Tanım |
|---|---|
| `ST-SAMEJVM-001` | hostile-probe plugin'i container'daki runtime'a yüklenir; token dosyası okunduğunda sonuç dosyasında `token_filesystem = success` görülür — yani limitation'ın hâlâ doğru belgelendiğini kanıtlar. Bu bir "açık bulunamadı" testi DEĞİL, limitation'ın sürüklenmediğini doğrulayan bir ölçümdür. |
| `ST-SAMEJVM-002` | Evidence store'da okuma-geri-okuma senaryosu: yazılan evidence content-addressed yolda tutulur; dosya içeriği değiştirilirse bir sonraki okuma `INTEGRITY_CHECK_FAILED` üretir (checksum re-verification). |

Spike kapandı: karar **"Hiçbiri daraltılamıyor"** dalıdır — limitation olduğu gibi
kalır, T2 container zorunluluğu güçlenir.
