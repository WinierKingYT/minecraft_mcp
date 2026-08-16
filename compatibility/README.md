# Compatibility profiles

Bir uyumluluk profili, ürünün üzerinde çalışmayı taahhüt ettiği **tek** sürüm kombinasyonunu kilitler. Aktif profil runtime üretir; diğer profiller diverjans (multi-profile) için tanımlanır ve doğrulanmadan kullanılamaz.

> **D0C kilidi (2026-08-07):** Bu üç profil Architecture Freeze itibarıyla **donmuştur**. Değişiklik ADR gerektirir (kural 3) ve tam conformance koşusu tetikler. `verify:compatibility` her koşuda doğrulama kapısıdır.

| Profil | Durum | Doğrulama |
|---|---|---|
| [`paper-26.2-build-84-v1.yaml`](paper-26.2-build-84-v1.yaml) | `active` | ✅ `verified` |
| [`paper-26.2-build-87-v1.yaml`](paper-26.2-build-87-v1.yaml) | `active` | ✅ `verified` |
| [`paper-26.2-build-90-v1.yaml`](paper-26.2-build-90-v1.yaml) | `active` | ✅ `verified` |

## Kurallar

1. Profil dosyası **normatif kaynaktır**. Kod içine gömülü sürüm sabiti bulunamaz; her bileşen profili okur.
2. `latest`, `current`, `stable` gibi hareketli ifadeler artifact manifest'inde kullanılamaz (DOC-GATE-02).
3. Profil değişikliği ADR gerektirir ve tam conformance test koşusu tetikler.
4. `verification.status: unverified` olduğu sürece:
   - D0A kapatılamaz,
   - release build üretilemez,
   - ürün `prototype` kanalından çıkamaz.

## Doğrulama

```bash
pnpm run verify:compatibility
```

Script her `pending_fields` alanını resmî kaynaktan çözer:

| Alan | Kaynak |
|---|---|
| `minecraft.version`, `paper.build`, `paper.jar_sha256` | PaperMC Downloads Service v3 |
| `paper.api_coordinate` | Paper Maven repository |
| `mcp.protocol_version` | MCP specification revision listesi |
| `mcp.sdk_prototype.*` | npm registry |
| `node.version` | Node.js release schedule |
| `gradle.wrapper_version`, `gradle.distribution_sha256` | `services.gradle.org` checksum endpoint |
| `maven.version`, `maven.distribution.sha256`, `maven.wrapper.jar_sha256` | `repo.maven.apache.org` maven2 koordinatı (bin.zip SHA-256, `--verify-jar` ile canlı) |
| `java.runtime_major` | Yerel `java -version` + toolchain kontrolü |
| `npm_toolchain` | `pnpm install` + commit edilmiş lockfile |

Doğrulanan alan `pending_fields` listesinden `verified_fields` listesine taşınır. Tüm alanlar doğrulandığında `verification.status: verified` olur.

## Bilinen açık soru

V3 sözleşme belgesindeki `paper.api_coordinate` değeri (`io.papermc.paper:paper-api:26.2.build.84-stable`), Paper'ın tarihsel `<mc>-R0.1-SNAPSHOT` şemasından farklıdır. Doğrulama sırasında gerçek Maven koordinatı teyit edilmeli; farklıysa profil düzeltilmeli ve ADR notu eklenmelidir.
