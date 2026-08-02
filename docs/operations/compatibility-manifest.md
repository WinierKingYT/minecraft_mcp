# Uyumluluk manifestosu

Bu belge, MCP development toolchain'ın hangi sürümlerle test edildiğini ve hangi sürümlerin desteklendiğini tanımlar.

## Aktif uyumluluk profili

**Dosya:** `compatibility/paper-26.2-build-84-v1.yaml`

| Bileşen | Sürüm | Doğrulandı |
|---|---|---|
| Minecraft | 26.2 | ✅ |
| Paper | build 84 (STABLE) | ✅ |
| Java | 25 (Temurin 25.0.4.7) | ✅ |
| Node.js | v24.18.1 (LTS Krypton) | ✅ |
| Gradle | 9.6.1 | ✅ |
| MCP Protocol | 2026-07-28 (final) | ✅ |
| MCP SDK | 2.0.0 (stable) | ✅ |
| pnpm | 10.15.0 | ✅ |
| TypeScript | 5.9.3 | ✅ |

**Durum:** `verified` — tüm 16 alan doğrulanmış (2026-08-02).

## Profil yapısı

```yaml
paper:
  api_coordinate: "io.papermc.paper:paper-api:26.2.build.84-stable"
  api_version: "1.21"
  build: 84
  channel: stable
  game_version: "26.2"
  jar_sha256: "< Paper JAR checksum >"
java:
  runtime_major: 25
  toolchain_major: 25
  distribution: temurin
  distribution_version: "25.0.4.7"
node:
  version: "24.18.1"
  lts: "Krypton"
gradle:
  version: "9.6.1"
  wrapper_validation: true
mcp:
  protocol_version: "2026-07-28"
  protocol_final: true
  sdk_coordinate: "@modelcontextprotocol/server@2.0.0"
  sdk_stable: true
  sdk_linked: false
  transport: stdio
toolchain:
  pnpm: "10.15.0"
  typescript: "5.9.3"
verification:
  status: verified
  verified_at: "2026-08-02T00:00:00Z"
  verified_by: "D0A exit condition"
```

## Profil nasıl kullanılır

### Yeni proje eklerken

1. Paper sürümünü seçin: `paper-<sürüm>-build-<build>-<kanal>.yaml`
2. `compatibility/` dizinine koyun
3. `scripts/verify-compatibility.mjs` ile doğrulayın
4. `package.json`'da referans verin

### Sürüm güncellerken

1. Yeni profile'ı `compatibility/` dizinine ekleyin
2. Eski profili silin (yalnızca bir aktif profil olmalı)
3. `scripts/verify-compatibility.mjs --write` ile checksum'ları güncelleyin
4. CI'ı çalıştırın — tüm testler geçmeli

### Doğrulama

```bash
# Profili doğrula
node scripts/verify-compatibility.mjs

# CI'da zorunlu doğrulama
node scripts/verify-compatibility.mjs --require-verified
```

## Doğrulama yöntemi

Her alan resmi kaynaklardan doğrulanır:

| Alan | Kaynak | Doğrulama |
|---|---|---|
| Paper build | PaperMC API | Build numarası ve kanal |
| Paper JAR SHA | PaperMC download | İndirme checksum'ı |
| Java version | Adoptium API | Sürüm ve dağıtım |
| Node.js version | Node.js release | LTS durumu |
| Gradle version | Gradle releases | Sürüm |
| MCP Protocol | MCP spec repo | Revizyon ve final durumu |
| MCP SDK | npm registry | Stable/alpha durumu |
| pnpm version | npm registry | Sürüm |
| TypeScript version | npm registry | Sürüm |

## Eski profiller

Eski profiller `compatibility/` dizininden kaldırılır. Yalnızca bir aktif profil desteklenir.

## İlgili belgeler

- [supply-chain.md](../security/supply-chain.md) — Gradle wrapper ve dependency locking
- [threat-model.md](../security/threat-model.md) — Güvenlik sınıfları
- [guarantees.md](../security/guarantees.md) — Garantiler ve limitationlar
