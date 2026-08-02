# ADR-0009 — Node.js pini güvenlik sürümüne taşındı (24.18.0 → 24.18.1)

**Durum:** accepted
**Tarih:** 2026-07-30
**Bağlam:** Uyumluluk profili doğrulaması; [`../../compatibility/paper-26.2-build-84-v1.yaml`](../../compatibility/paper-26.2-build-84-v1.yaml)

## Bağlam

V3 sözleşme belgesi Node'u `24.18.0` LTS'e pinliyordu. Profil doğrulaması sırasında bu sürümün gerçekten var olduğu (2026-06-23, LTS "Krypton") teyit edildi — fakat aynı listede **24.18.1** (2026-07-28) bir **güvenlik sürümü** olarak işaretli çıktı.

Uyumluluk profilinin amacı sürümleri **dondurmaktır**, bu yüzden pini değiştirmek varsayılan davranış değildir ve ADR gerektirir. Ancak burada iki kural çarpışıyor:

| Kural | Yön |
|---|---|
| "Sürümler kilitlidir; değişiklik ADR gerektirir" | Pini koru |
| "Her güvenlik iddiası test veya limitation taşır" (ADR-0007) | Pini taşı |

## Karar

Node pini **24.18.1**'e taşındı.

| Alan | Eski | Yeni |
|---|---|---|
| `node.version` | `24.18.0` | `24.18.1` |
| `package.json` `engines.node` | `24.18.0` | `24.18.1` |

`.npmrc` içindeki `engine-strict=true` yürürlüktedir: uyuşmayan bir Node sürümünde `pnpm install` **durur**, uyarı vermez.

### Neden bu bir "sürüm kayması" değildir

- Aynı major, aynı minor, aynı LTS hattı (`Krypton`).
- Yalnızca güvenlik düzeltmesi içerir; API yüzeyi değişmez.
- Yeni pin de tam sürüm numarasıdır; `latest` veya aralık ifadesi kullanılmamıştır (DOC-GATE-02).

### Yenileme politikası

Bundan sonra **aynı minor hattındaki güvenlik sürümleri** için ADR gerekmez; profil güncellenir ve bu ADR'ye atıf yapılır. Minor veya major değişikliği ADR gerektirmeye devam eder.

Gerekçe: her güvenlik yamasında yeni bir ADR yazma zorunluluğu, pratikte yamaların ertelenmesine yol açar — kuralın kendisi güvenliği zayıflatır.

## Alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| `24.18.0`'da kalmak | Kendisi bir güvenlik doğrulama aracı olan ürünün, bilinen düzeltmesi olan bir runtime'a pinli kalması savunulamaz |
| `engine-strict`'i kapatmak | Profilin zorlayıcılığını kaldırır; "kilitli sürüm" iddiası test edilemez hâle gelir |
| Pini minor aralığa (`^24.18`) açmak | DOC-GATE-02 ihlali: hareketli sürüm ifadesi; ayrıca reproducible build hedefini kırar |
| Her güvenlik yaması için ayrı ADR | Sürtünme yamaları geciktirir; kuralın kendisi güvenliği zayıflatır |

## Sonuçlar

**Olumlu**

- Bilinen güvenlik düzeltmesi alındı.
- `engine-strict` sayesinde uyuşmazlık sessiz kalmıyor.
- Güvenlik yaması yenileme politikası netleşti.

**Olumsuz**

- Geliştiricilerin Node kurulumunu güncellemesi gerekir; eski sürümde `pnpm install` çalışmaz.
- CI runner'ları da pinlenmiş sürümü kullanmak zorundadır (workflow profili okuyarak bunu zaten yapıyor).

**Kanıt:** `pnpm install` başarısı; `UT-COMPATIBILITY-PROFILE-001`.

## İlgili

- [`../../compatibility/README.md`](../../compatibility/README.md)
- [ADR-0007](0007-security-claims.md)
