# Doküman kalite kapıları

Bu kapılar CI'da otomatik çalışır. İhlal PR'ı bloklar.

## DOC-GATE-01 — Boyut, bölünme ve tekrar

| Kural | Denetim |
|---|---|
| `docs/MASTER-PLAN.md` hedefi 600–1.200 satır | `scripts/check-docs.mjs` |
| Ayrıntılı bölümler konu dosyalarında | Manuel review + link check |
| Aynı kabul kriteri iki bölümde farklı anlamla bulunamaz | Manuel review |
| Roadmap ve release checklist çelişemez | `scripts/check-docs.mjs` |
| Registry ve schema tabloları **generated** olmalıdır | `pnpm run gen:check` |

## DOC-GATE-02 — Belirsizlik

| Kural | Denetim |
|---|---|
| Sürüm placeholder'ı yok (`TODO`, `TBD`, `X.Y.Z`, `<version>`) | `scripts/check-docs.mjs` |
| Karar placeholder'ı yok | `scripts/check-docs.mjs` |
| `latest` / `current` / `stable` release manifest'te yok | `scripts/check-docs.mjs` |
| Açık karar issue kimliği taşır | Manuel review |
| Conditional feature açık go/no-go gate taşır | Manuel review |

> **Not:** Uyumluluk profilinin `verification.status: unverified` olması bu kapıyı ihlal etmez; bu bir *belirsizlik gizlemesi* değil, açıkça beyan edilmiş ve gate'e bağlanmış bir durumdur. Kapıyı ihlal eden şey, doğrulanmamış bir değeri doğrulanmış gibi sunmaktır.

## DOC-GATE-03 — Parse

| Kural | Denetim |
|---|---|
| Tüm JSON parse eder | `scripts/check-parse.mjs` |
| Tüm YAML parse eder | `scripts/check-parse.mjs` |
| Tüm schema validate eder | `scripts/validate-schemas.mjs` |
| Mermaid render eder | CI adımı |
| Link checker geçer | CI adımı |

## DOC-GATE-04 — Registry

| Kural | Denetim |
|---|---|
| Duplicate capability yok | `scripts/validate-registry.mjs` |
| Duplicate error code yok | `scripts/validate-registry.mjs` |
| Orphan schema yok | `scripts/validate-registry.mjs` |
| Her exposed tool capability'ye bağlı | `scripts/validate-registry.mjs` |
| Her mutation risk metadata taşır | `scripts/validate-registry.mjs` |

## DOC-GATE-05 — İzlenebilirlik

Her V1 requirement JTBD · ADR · capability · epic · test · evidence · gate alanlarına sahip olmalıdır.

Kaynak: [`../traceability.md`](../traceability.md) — boş hücre CI hatasıdır.

## DOC-GATE-06 — Güvenlik dürüstlüğü

| Kural | Denetim |
|---|---|
| Trusted Local **sandbox olarak adlandırılmaz** | `scripts/check-docs.mjs` (yasak ifade taraması) |
| Same-JVM limitation açık | `scripts/check-docs.mjs` (zorunlu ifade varlığı) |
| Agent-facing destructive tool yok | `scripts/validate-registry.mjs` |
| Her güvenlik iddiası test veya limitation taşır | Manuel review + [`../security/guarantees.md`](../security/guarantees.md) |

Yasak ifade taraması, `trusted-local` / `trusted local` / `TrustedLocal` yakınında `sandbox` kelimesinin geçmesini arar ve bulursa CI'ı kırar. Bu, iyi niyetli bir dokümantasyon düzeltmesinin KPI-11'i sessizce ihlal etmesini engeller.
