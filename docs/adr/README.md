# Mimari kararlar (ADR)

| ADR | Başlık | Durum |
|---|---|---|
| [0001](0001-process-topology.md) | Deployable process topolojisi | accepted |
| [0002](0002-mcp-stdio-transport.md) | MCP `stdio` taşıması ve SDK bağımlılığı | kısmen superseded by ADR-0008 |
| [0003](0003-run-supervisor-process.md) | Ayrı Run Supervisor process'i | accepted |
| [0004](0004-execution-backends.md) | Execution backend soyutlaması ve güven sınıfı eşleşmesi | accepted |
| [0005](0005-plugin-metadata-policy.md) | `plugin.yml` resmî, `paper-plugin.yml` deneysel | accepted |
| [0006](0006-m2a-m2b-split.md) | M2A / M2B ayrımı | accepted |
| [0007](0007-security-claims.md) | Güvenlik iddiaları ve dürüstlük kuralları | accepted |
| [0008](0008-stateless-protocol-and-stable-sdk.md) | Stateless protokol yüzeyi ve stable SDK durumu | accepted |
| [0009](0009-node-security-pin.md) | Node pini güvenlik sürümüne taşındı | accepted |
| [0010](0010-mcp-sdk-2-adoption.md) | MCP SDK 2.0.0'a geçiş ve official-client conformance kapanışı | accepted |
| [0011](0011-maven-wrapper-profile.md) | Maven Wrapper profil bloğu ve build-system seçimi | superseded by ADR-0012 |
| [0012](0012-maven-profile-model-refactor.md) | Maven profil bloğu: dağıtım ve wrapper sürümlerinin ayrılması | accepted |
| [0013](0013-wrapper-execution-trust-model.md) | Wrapper yürütme güven modeli: supervisor-only | accepted |
| [0014](0014-standalone-distribution.md) | Tek npm paketi (standalone) dağıtımı ve layout self-location | accepted |

## Şablon

```markdown
# ADR-NNNN — <Başlık>

**Durum:** proposed | accepted | superseded by ADR-XXXX
**Tarih:** YYYY-MM-DD
**Bağlam:** <hangi requirement / JTBD / spike>

## Bağlam
Hangi problem, hangi kısıtlar.

## Karar
Tek cümlelik karar, ardından ayrıntı.

## Alternatifler
| Alternatif | Neden reddedildi |

## Sonuçlar
Olumlu / olumsuz sonuçlar, hangi testlerle kanıtlanır.

## İlgili
<capability / gate / belge bağlantıları>
```

## Kural

Bir ADR kabul edildikten sonra **düzenlenmez**; değişiklik yeni bir ADR ile yapılır ve eskisi `superseded by` ile işaretlenir. Spike sonuçları ADR'ın "Bulgular" bölümüne değil, ilgili spike dosyasına yazılır; ADR yalnızca kararı taşır.
