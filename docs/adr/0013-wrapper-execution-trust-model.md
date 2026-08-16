# ADR-0013 — Wrapper yürütme güven modeli: supervisor-only

**Durum:** accepted
**Tarih:** 2026-08-16
**Supersedes:** yok
**Bağlam:** [`../delivery/beyond-v1.md`](../delivery/beyond-v1.md)

## Bağlam

Maven Wrapper supply-chain doğrulaması (ST-MAVEN-001..006) wrapper JAR'ı ve
`distributionSha256Sum`'ı doğruluyordu; ancak `mvnw`/`mvnw.cmd` script'lerinin
kendisi checksum'lanmıyordu. Bu doğru bir gözlemdi — script, doğrulanmış Maven
dağıtımı indirilmeden **önce** çalışan kod. Bir saldırgan projesinin `mvnw`
script'ini değiştirirse:

- dağıtım checksum'ı ✅ doğru görünebilir,
- fakat saldırgan kod Maven'dan önce çalışır.

Burada iki ayrı güven modeli düşünülebilirdi:

- **A — script checksum pin:** profillere `mvnw` script hash'leri eklenir.
- **B — supervisor-only:** proje script'i asla çalıştırılmaz; supervisor kendi
  verified binary'sini/launcher'ını kullanır.

Ayrıca bu projenin **Gradle problemi zaten çözmüştü**: `trusted-local-backend.ts`
(`GRADLE_WRAPPER_MAIN`) `gradlew`/`gradlew.bat` script'lerini çalıştırmaz;
checksum'ı doğrulanmış `gradle-wrapper.jar`'ı `java -cp` ile launcher olarak
kullanır. Yani "proje script'ini çalıştırma" kuralı üründe mevcut bir önceliktir;
Maven tarafı henüz bu modele dokunmamıştı.

## Karar

**Güven modeli supervisor-only'dir (seçenek B).** Uygulama detayı:

1. Proje `mvnw`/`mvnw.cmd` script'leri ürün tarafından **asla çalıştırılmaz**;
   script, trust boundary'nin dışındadır (Gradle önceliyle birebir aynı kural).
2. Wrapper **JAR** `bin` modunda launcher olabilir; checksum profilde knitli ve
   validator tarafından zorlanır (MVN_WRAPPER_JAR_UNVERIFIED) — Gradle'ın
   `gradle-wrapper.jar` yaklaşımının birebir karşılığı.
3. `only-script` modunda (JAR yok) supervisor, dağıtımı kendi **verified**
   dağıtımından (profil `maven.distribution.*`) provision eder; projenin
   `distributionUrl`'si yalnızca sürüm uyumu için doğrulanır (MVN_VERSION_INCOMPATIBLE).
4. `distributionType` değeri `project_validate` sonucunda kanıt kaydı olarak
   taşınır (yürütme yüzeyinin explicit hâli).
5. **`MVN_WRAPPER_SCRIPT_UNVERIFIED` hata kodu BİLİNÇLİ OLARAK TANIMLANMADI.**
   Ürün script'i çalıştırmadığı için "script doğrulanamadı" bulgusu, gerçekte
   ürünü etkileyen bir güvenlik ihlaliymiş gibi **yanlış güvenlik iddiası** üretir
   (DOC-GATE-06). Script yalnızca yerel `./mvnw` çalıştıran geliştiricinin kendi
   eylemidir; ürünün trust sınırına girmez.

## Alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| A — `wrapper.scripts.unix_sha256`/`windows_sha256` pinlemek + error kodu | Resmî script'ler LF/CRLF farkıyla iki byte görünümü taşır; tek hash anlamsızlaşır. Daha önemlisi: ürün script'i çalıştırmayacağından, eşleşmeyen script için hata üretmek "çalıştırılmayan kod güvensizdir" iddiası olur — DOC-GATE-06'yı ihlal eder |
| Hibrit — A doğrulamada, B yürütmede | İktidarın düşüncesi (A) + uygulamanın gerçeği (B) çelişir; eşleşmeyen script için üretilen hata yine yanlış pozitif riski taşır |
| Script'i doğrulayıp `warning` seviyesinde bildirmek | Niyetsel olarak makul; ancak repository'nin "bulgu = uygulanabilir risk" disiplininde, ürünü etkilemeyen bir warning koleksiyonu gürültü üretir. Gerekirse yürütme ADR'sinde eklenir |

## Sonuçlar

**Olumlu**

- Maven yürütme yüzeyi Gradle ile asimetri taşımaz: iki build sistemi de
  "proje script'i çalıştırılmaz, launcher/dağıtım doğrulanır" kuralındadır.
- `wrapper.jar_sha256` pin'i artık kanıta bağlıdır: `verify:compatibility
  --verify-jar`, resmî `org.apache.maven.wrapper:maven-wrapper` koordinatından
  JAR indirip profil hash'i ile canlı karşılaştırır (yalnızca regex değil).
- `distributionType` ayrıştırılır ve doğrulama sonucunda taşınır; executor
  (yürütme ADR'si) bin/only-script ayrımını bu kanıt üzerinden yapabilir.

**Olumsuz**

- `MVN_WRAPPER_SCRIPT_UNVERIFIED` (başlangıçtaki önerideki kod) tanımlanmadı;
  bu karar, önerinin kapsamını açıkça düzeltir. Beklenti varsa prosedür
  dokümantasyonu güncellenmelidir — bu ADR gerekçelendirilmiş reddi tutar.
- `MavenValidationResult` düzeyinde `wrapper.distributionType` alanı eklendi
  (agent contract'ına taşınmadı; ihtiyaç yürütme ADR'sinde değerlendirilir).

**Kanıt:** `apps/run-supervisor/test/maven-validation.test.ts`
(ST-MAVEN + distributionType yüzeyi), `scripts/verify-compatibility.mjs
--verify-jar` (canlı: resmî maven-wrapper-3.3.2.jar sha256 = profil pin'i);
`pnpm run check` yeşil.

## İlgili

- [ADR-0012](0012-maven-profile-model-refactor.md) — maven blok modeli
- [`apps/run-supervisor/src/trusted-local-backend.ts`](../../apps/run-supervisor/src/trusted-local-backend.ts)
- [`../security/supply-chain.md`](../security/supply-chain.md)
- [`apps/run-supervisor/src/maven-validation.ts`](../../apps/run-supervisor/src/maven-validation.ts)