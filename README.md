# Minecraft Plugin Development MCP

Yapay zekâ kodlama ajanlarının Paper eklentilerini **gerçek Paper üzerinde derleyip çalıştırmasını**, sınırlandırılmış test eylemleriyle doğrulamasını ve **kanıtlanabilir** başarısızlık raporu üretmesini sağlayan yerel geliştirme altyapısı.

> **Durum:** `prototype` — çekirdek (M0–M3) ve V1.1 yatay yetenekleri tamamlandı; V1 release kapanışı yapıldı (2026-08-16).
> Gerçek Paper üzerinde build/runtime/scenario/evidence zinciri çalışıyor (M2A/M2B kapandı),
> MCP protokol yüzeyi resmî `@modelcontextprotocol/*` 2.0.0 SDK'sı üzerindedir (ADR-0010,
> conformance 57/57, protokol `2026-07-28`). Public V1, paketleme/kurulum/release
> katmanları tamamlanana kadar `prototype` kanalında kalır.
> Tek durum kaynağı: [`status/project-status.yaml`](status/project-status.yaml).

## Bu ürün ne değildir

- Canlı Minecraft sunucusu yönetim aracı değildir.
- Serbest shell / RCON / Minecraft konsolu erişimi vermez.
- Genel amaçlı Minecraft botu değildir.
- Uzak MCP veya çok kullanıcılı bulut hizmeti değildir.
- **`trusted-local` backend bir sandbox değildir.** Kötü niyetli Java/Gradle koduna karşı host izolasyonu sağlamaz. Bkz. [`docs/security/threat-model.md`](docs/security/threat-model.md).

## Kapalı döngü

```text
proje kaydı -> source snapshot -> supply-chain doğrulama -> izole build
  -> artifact provenance -> disposable Paper runtime -> ready gate
  -> deterministik fixture -> test eylemleri -> assertion
  -> evidence + rapor -> güvenli cleanup -> retention
```

## Belgeler

| Belge | İçerik |
|---|---|
| [`docs/MASTER-PLAN.md`](docs/MASTER-PLAN.md) | Kararlar ve bağlantılar (kısa özet) |
| [`docs/product/`](docs/product/) | JTBD, kapsam, KPI |
| [`docs/architecture/`](docs/architecture/) | Process topolojisi, kimlikler, durum makineleri |
| [`docs/adr/`](docs/adr/) | Mimari kararlar |
| [`docs/contracts/`](docs/contracts/) | MCP, Bridge, DSL, config sözleşmeleri |
| [`docs/security/`](docs/security/) | Threat model, güvenlik garantileri |
| [`docs/testing/`](docs/testing/) | Test stratejisi ve kalite kapıları |
| [`docs/delivery/`](docs/delivery/) | Roadmap, milestone kabul kriterleri, spike'lar |
| [`docs/operations/`](docs/operations/) | Kurulum, doctor, incident response |

Kaynak sözleşme belgesi (V3, tek dosya): sürüm kontrolü dışında tutulur; bu repository'deki `docs/` ağacı normatif kaynaktır.

## Kilitlenmiş uyumluluk profili

[`compatibility/paper-26.2-build-84-v1.yaml`](compatibility/paper-26.2-build-84-v1.yaml)

> Üç aktif profil de `verification.status: verified` (build 84/87/90, canlı kaynaktan doğrulanmış — `scripts/verify-compatibility.mjs`).

## Depo yapısı

```text
apps/mcp-server/            MCP Server process (stdio)
apps/run-supervisor/        Run Supervisor process (build, runtime, ownership)
bridge/paper/               Paper Bridge plugin (Java, Paper JVM içinde)
actors/protocol-test-actor/ Protocol Test Actor (M2B, conditional)
packages/contracts/         Paylaşılan JSON Schema sözleşmeleri
packages/capability-registry/ Capability kayıtları (tek gerçek kaynak)
packages/error-catalog/     Error code kayıtları (tek gerçek kaynak)
packages/generated-types/   Üretilmiş TS/Java tipleri (elle düzenlenmez)
packages/evidence-model/    Evidence ve report modeli
packages/config-schema/     Ürün config şeması
packages/test-fixtures/     Test fixture yardımcıları
compatibility/              Uyumluluk profilleri
fixtures/                   Dünyalar, örnek projeler, config'ler, manifest'ler
scenarios/                  Scenario DSL dosyaları
scripts/                    Codegen, doğrulama, doctor
```

## Geliştirme

Gereksinimler profil tarafından kilitlenmiştir (Node, Java, Gradle sürümleri için profile bakın).

```bash
pnpm install
```

```bash
pnpm run gen && pnpm run check
```

`pnpm run gen` capability/error registry'den tipleri üretir; `pnpm run check` parse, schema, drift, lint ve test kapılarını çalıştırır. CI aynı komutları koşar (`.github/workflows/pr.yml`).

## Lisans

MIT — bkz. [`LICENSE`](LICENSE).
