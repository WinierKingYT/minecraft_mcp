# Supply chain güvenliği

## Gradle Wrapper

Zorunlu varlıklar:

- `gradlew` / `gradlew.bat`
- `gradle/wrapper/gradle-wrapper.jar`
- `gradle/wrapper/gradle-wrapper.properties`

Zorunlu doğrulamalar:

- Wrapper JAR checksum verification
- `distributionUrl` allowlist (`services.gradle.org`)
- `distributionSha256Sum` mevcut ve geçerli
- Profilde kilitli Gradle sürümü

Hata kodları:

```text
GRADLE_WRAPPER_NOT_FOUND
GRADLE_WRAPPER_JAR_UNVERIFIED
GRADLE_DISTRIBUTION_URL_UNAPPROVED
GRADLE_DISTRIBUTION_CHECKSUM_MISSING
GRADLE_DISTRIBUTION_CHECKSUM_INVALID
GRADLE_VERSION_INCOMPATIBLE
```

## Maven Wrapper

Gradle kurallarının birebir aynısı, Maven projeleri için (`apps/run-supervisor/src/maven-validation.ts`).

Zorunlu varlıklar:

- `mvnw` / `mvnw.cmd`
- `.mvn/wrapper/maven-wrapper.properties`
- `.mvn/wrapper/maven-wrapper.jar` — **yalnızca mevcutsa** doğrulanır: maven-wrapper 3.2+ `distributionType=only-script` modunda JAR projede bulunmayabilir (JAR build'den önce çalışan kod olduğu için "yok" bulgu değildir; "var fakat doğrulanmamış" bulgudur).

Zorunlu doğrulamalar:

- Wrapper JAR checksum verification (mevcutsa)
- `distributionUrl` allowlist (`repo.maven.apache.org`)
- `distributionSha256Sum` mevcut ve geçerli
- Profilde kilitli Maven sürümü
- `pom.xml` üzerinde dinamik sürüm (aralık, `LATEST`/`RELEASE`, `n.+`) ve SNAPSHOT taraması

Bilinçli kapsam farkları:

- Maven'ın standardı gereği Gradle'daki `verification-metadata.xml` / `gradle.lockfile` kuralı uygulanmaz; o kontroller Gradle tarafına aittir.
- Wrapper JAR `only-script` modunda bulunmayabilir (yukarıya bakın).

Hata kodları:

```text
MVN_WRAPPER_NOT_FOUND
MVN_WRAPPER_JAR_UNVERIFIED
MVN_DISTRIBUTION_URL_UNAPPROVED
MVN_DISTRIBUTION_CHECKSUM_MISSING
MVN_DISTRIBUTION_CHECKSUM_INVALID
MVN_VERSION_INCOMPATIBLE
```

Paylaşılan kodlar (Gradle ile aynı kural ailesi):

```text
DYNAMIC_DEPENDENCY_FORBIDDEN
CHANGING_MODULE_FORBIDDEN

## Dependency locking

- Lock files release profilinde zorunludur
- Dynamic version yasaktır
- Changing module ve SNAPSHOT release profilinde yasaktır
- Lock drift CI hatasıdır
- Provisioning lock update ayrı onaylı workflow ile yapılır

## Dependency verification

- `gradle/verification-metadata.xml` zorunludur
- SHA-256 veya SHA-512 kullanılmalıdır
- Mümkünse signature da doğrulanmalıdır
- Verification mode **`strict`** olmalıdır
- Bootstrap edilen metadata **manuel review bekler**
- Eksik checksum hata üretir
- Gradle plugin dependency'leri de doğrulanır
- **Metadata boş bir `GRADLE_USER_HOME` ile üretilmelidir** (aşağıya bakın)

### Metadata soğuk cache ile üretilmelidir

**Ölçülmüş bulgu.** `--write-verification-metadata`, o an **indirilmesi gereken** artefaktları kaydeder. Gradle cache'i zaten doluysa POM ve BOM metadata dosyaları hiç indirilmez ve metadata'ya girmez.

Sonuç: geliştiricinin makinesinde çalışan, temiz bir makinede — yani CI'da — `DEPENDENCY_VERIFICATION_FAILED` ile düşen bir yapılandırma. Eksiklik **sessizdir**; dosya var, `verify-metadata` açık, checksum'lar SHA-256, fakat kayıt eksiktir.

Kendi `bridge/paper` projemizde ölçüldü: sıcak cache 78 component kaydetti, soğuk cache 91. Aradaki 13 dosya ilk temiz build'i düşürüyordu.

```bash
GRADLE_USER_HOME=$(mktemp -d) ./gradlew --write-verification-metadata sha256 build
```

Mevcut dosya önce silinmelidir; aksi hâlde Gradle eksikleri tamamlamak yerine mevcut dosyaya karşı doğrulama yapıp düşer.

#### Bu eksiklik statik olarak yakalanamaz

Sayısal bir sezgi işe yaramaz. Ölçüldü: hatalı metadata 78 component taşıyordu ve `gradle.lockfile` 59 modül listeliyordu — yani "metadata ≥ lockfile" kuralı hatalı dosyayı da geçirirdi. Doğru sayı 91'dir, fakat bu ancak soğuk bir koşuyla bilinebilir.

**Tek güvenilir koruma, temiz bir makinede build çalıştırmaktır.** CI runner'ı her koşuda boş bir Gradle cache ile başlar; bu yüzden `.github/workflows/pr.yml` içindeki Java işi bu hatayı yakalar. Yerel geliştirmede sıcak cache hatayı maskeler.

Sonuç: **Gradle cache'ini CI'da önbelleğe almayın.** Hız kazancı, bu sınıf hataları görünmez kılma pahasına gelir.

Ayrıntı: [`../../bridge/paper/gradle/DEPENDENCY-VERIFICATION.md`](../../bridge/paper/gradle/DEPENDENCY-VERIFICATION.md)

Hata kodları:

```text
DEPENDENCY_LOCK_MISSING
DEPENDENCY_LOCK_OUT_OF_DATE
DEPENDENCY_VERIFICATION_MISSING
DEPENDENCY_VERIFICATION_FAILED
DYNAMIC_DEPENDENCY_FORBIDDEN
CHANGING_MODULE_FORBIDDEN
UNAPPROVED_REPOSITORY
```

## Build modları

Agent serbest Gradle task **veremez**. Yalnızca enum:

```yaml
mode: build | unit_test | integration_test | clean_build
```

Task mapping ürün config'inde bulunur ve agent tarafından değiştirilemez.

### Provisioning modu

| Özellik | Değer |
|---|---|
| Kullanıcı onayı | **Zorunlu** |
| Backend | **Container zorunlu** |
| Ağ | Repository allowlist |
| Çıktı | Lock ve verification metadata |
| Audit | Zorunlu |
| Sonuç | **Manuel review bekler; otomatik trusted olmaz** |

### Reproducible modu

| Özellik | Değer |
|---|---|
| Ağ | **Kapalı** |
| Gradle | `--offline` |
| Verification | `strict` |
| Lock file | Zorunlu |
| Dependency cache | Read-only |
| HOME | Geçici |
| Resource limits | Zorunlu |

## Node.js tarafı

- `package.json` içinde tüm sürümler **exact** (aralık operatörü yok)
- Lockfile commit edilir ve CI `--frozen-lockfile` ile kurar
- `packageManager` alanı pinlenir
- Release artifact'leri SBOM ve checksum taşır

> ⚠️ Bootstrap sırasında npm sürüm pinleri (`typescript`, `ajv`, `yaml`, `pnpm`, `@types/node`) yalnızca aday olarak yazıldı ve `pnpm install` ile teyit edilmedi. Lockfile commit edilene kadar `npm_toolchain.lockfile_committed: false`.

## Bağımlılık zafiyet taraması (dependency-scan)

`scripts/dependency-scan.mjs`, `pnpm-lock.yaml` ve `bridge/paper/gradle.lockfile` üzerindeki
purl'ları OSV `querybatch` API'sine sorar; bulguları severity eşiğine (varsayılan `high`)
göre raporlar. CI'da `dependency-scan` job'ı olarak çalışır.

- Severity kaynağı: OSV `database_specific.severity` (GitHub seviyesi); yoksa CVSS v3 base score.
- **Gate kuralı:** Eşiğin üstündeki bulgu, `security/dependency-scan.allowlist.yaml` içinde
  kayıtlı değilse iş kırmızıdır. Allowlist'e girdi, gerekçeli ve review ister; sessizce
  büyüyemez — yeni bulgu girilmemişse gate kırılır. Bileşen düzeltilince girdi "stale"
  uyarısı üretir ve çıkarılmalıdır.
- Build gerektirmez; canlı OSV verisi kullandığı için önbelleklenmez.

## Paper JAR

- İndirme URL'si **sabit metin olarak güvenilmez**; resmî Downloads Service yanıtından çözülür
- İndirilen JAR'ın SHA-256 değeri runtime image manifest'ine yazılır
- Her runtime oluşturmada checksum yeniden doğrulanır
- Uygun `User-Agent` gönderilir
