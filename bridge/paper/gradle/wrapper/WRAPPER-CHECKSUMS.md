# Wrapper bütünlük kayıtları

`project_validate` capability'si bu değerleri doğrular. Uyuşmazlık build'i durdurur — bkz. [`../../../../docs/security/supply-chain.md`](../../../../docs/security/supply-chain.md).

| Artefakt | SHA-256 | Kaynak |
|---|---|---|
| `gradle-wrapper.jar` | `497c8c2a7e5031f6aa847f88104aa80a93532ec32ee17bdb8d1d2f67a194a9c7` | Gradle 9.6.1 dağıtımının `gradle wrapper` görevi tarafından üretildi |
| `gradle-9.6.1-bin.zip` | `9c0f7faeeb306cb14e4279a3e084ca6b596894089a0638e68a07c945a32c9e14` | `services.gradle.org/distributions/gradle-9.6.1-bin.zip.sha256` |

## Üretim zinciri

Wrapper, checksum'ı doğrulanmış bir dağıtımdan üretildi:

1. `gradle-9.6.1-bin.zip` indirildi.
2. SHA-256 resmî checksum endpoint'i ile karşılaştırıldı — **eşleşti**.
3. Dağıtım açıldı ve `gradle wrapper --gradle-version 9.6.1 --distribution-type bin` çalıştırıldı.
4. Üretilen `gradle-wrapper.jar` hash'lendi ve bu dosyaya kaydedildi.

Wrapper JAR'ı doğrulanmamış bir kaynaktan (örneğin rastgele bir repository'den kopyalayarak) almak `GRADLE_WRAPPER_JAR_UNVERIFIED` üretir; test: `ST-GRADLE-001`.

## Yenileme

Gradle sürümü değiştiğinde bu dosya ve `gradle-wrapper.properties` birlikte güncellenmelidir. Sürüm değişikliği uyumluluk profilini de etkiler ve ADR gerektirir.
