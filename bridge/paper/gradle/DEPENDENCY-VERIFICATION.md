# Dependency locking ve verification

## Durum

| Artefakt | Durum |
|---|---|
| `../gradle.lockfile` | ✅ Üretildi |
| `verification-metadata.xml` | ⚠️ **Bootstrap edildi — manuel review bekliyor** |
| Doğrulanan modül sayısı | **91** (soğuk cache ile üretildi) |
| Checksum algoritması | SHA-256 |
| `verify-signatures` | `false` |

## ⚠️ Metadata SOĞUK cache ile üretilmelidir

**Ölçülmüş bulgu (2026-08-01).** Metadata ilk kez sıcak bir Gradle cache üzerinde üretildi ve **78 component** kaydetti. Temiz bir makinede (boş `GRADLE_USER_HOME`) ilk build şu hatayla düştü:

```text
Dependency verification failed for configuration ':compileClasspath'
17 artifacts failed verification:
  - adventure-bom-5.2.0.pom
  - junit-bom-5.13.4.module
  - log4j-bom-2.26.0.pom
  ...
```

Sebep: `--write-verification-metadata`, o an **indirilmesi gereken** artefaktları kaydeder. Cache zaten doluysa POM ve BOM metadata dosyaları hiç indirilmez, dolayısıyla metadata'ya girmez. Sonuç, kendi makinesinde çalışan fakat temiz bir makinede — yani CI'da — düşen bir yapılandırmadır.

Soğuk cache ile yeniden üretildiğinde sayı **91**'e çıktı: eksik 13 metadata dosyası.

**Kural:** verification metadata **her zaman boş bir `GRADLE_USER_HOME` ile** üretilir. Sıcak cache ile üretilen metadata eksiktir ve bu eksiklik sessizdir.

```bash
GRADLE_USER_HOME=$(mktemp -d) ./gradlew --write-verification-metadata sha256 build
```

Mevcut dosya önce **silinmelidir**; aksi hâlde Gradle eksikleri tamamlamak yerine mevcut dosyaya karşı doğrulama yapıp düşer.

## Bootstrap edilen metadata neden otomatik güvenilir değildir

`--write-verification-metadata`, o an indirilen artefaktların hash'lerini kaydeder. Zincir zaten ele geçirilmişse, bu komut **saldırganın artefaktını** meşrulaştırır. Bu yüzden ürünün kendi kuralı (`docs/security/supply-chain.md`) bootstrap çıktısını "manuel review bekler" durumunda tutar.

Review sırasında kontrol edilmesi gerekenler:

1. Her modülün beklenen bir bağımlılık olduğu.
2. `io.papermc.paper:paper-api` sürümünün uyumluluk profilindeki koordinatla aynı olduğu.
3. Beklenmedik bir repository'den gelen modül bulunmadığı.
4. Metadata'nın **soğuk cache** ile üretilmiş olduğu.
5. Mümkün olan modüller için imza doğrulamasının (`verify-signatures`) açılması.

Review tamamlandığında bu dosyadaki durum `⚠️` → `✅` yapılmalı ve gözden geçiren kişi/commit kaydedilmelidir.

## Yenileme

```bash
./gradlew dependencies --write-locks
```

Her ikisi de **onaylı provisioning workflow'u** üzerinden çalıştırılmalıdır; ağ erişimi gerektiren tek mod budur ve `PROVISIONING_APPROVAL_REQUIRED` ile korunur.

## İlgili hata kodları

`DEPENDENCY_LOCK_MISSING` · `DEPENDENCY_LOCK_OUT_OF_DATE` · `DEPENDENCY_VERIFICATION_MISSING` · `DEPENDENCY_VERIFICATION_FAILED` · `DYNAMIC_DEPENDENCY_FORBIDDEN` · `CHANGING_MODULE_FORBIDDEN` · `UNAPPROVED_REPOSITORY`
