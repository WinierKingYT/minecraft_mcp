# Test belgeleri

| Belge | İçerik |
|---|---|
| [`strategy.md`](strategy.md) | Test katmanları, E2E akışı, resilience, determinizm gate'i |
| [`security-tests.md`](security-tests.md) | Negatif güvenlik test listesi ve beklenen hata kodları |
| [`actor-strategy.md`](actor-strategy.md) | M2A/M2B ayrımı ve actor spike gate'i |
| [`doc-gates.md`](doc-gates.md) | DOC-GATE-01..06 ve otomatik denetimleri |

## Test kimlik önekleri

| Önek | Katman |
|---|---|
| `UT-` | Unit |
| `CT-` | Contract |
| `IT-` | Integration (gerçek Paper dahil) |
| `ST-` | Security (negatif) |
| `E2E-` | Uçtan uca |

Test kimlikleri capability kayıtlarındaki `tests` alanından türetilir; kayıtta olmayan bir kimliğe atıf yapan belge DOC-GATE-04'ü ihlal eder.
