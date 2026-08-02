# ADR-0007 — Güvenlik iddiaları ve dürüstlük kuralları

**Durum:** accepted
**Tarih:** 2026-07-29
**Bağlam:** KPI-11, DOC-GATE-06; [`../security/guarantees.md`](../security/guarantees.md)

## Bağlam

Bu ürün, kullanıcıya "AI'ın yazdığı kodu güvenle çalıştır" mesajı veriyor. Böyle bir üründe yanlış bir güvenlik iddiası, hiç iddia olmamasından **daha tehlikelidir**: kullanıcı, olmayan bir korumaya güvenerek gerçekten kötü niyetli kod çalıştırır.

İki spesifik risk var:

<!-- kpi-11-exempt: bu ADR'nin bağlam bölümü, yanlış izlenimin kaynağını tarif ediyor -->

1. `TrustedLocalBackend`'in path confinement, environment allowlist ve timeout gibi kontrolleri "sandbox" izlenimi veriyor. Vermemesi gerekiyor: aynı kullanıcı yetkileriyle çalışan Java kodu bu kontrolleri aşabilir.
2. Paper Bridge, hedef plugin ile **aynı JVM'de** çalışıyor. Loopback + token auth'u, rastgele process'lere karşı işe yarar; aynı adres alanındaki aktif saldırgana karşı yaramaz.

Bu iki gerçek, zamanla iyi niyetli dokümantasyon düzenlemeleriyle sulanma eğilimindedir.

## Karar

### 1. Yasaklı ifade

> `trusted-local` backend **hiçbir yerde** sandbox olarak adlandırılamaz — belge, kod yorumu, hata mesajı, README, commit mesajı veya kullanıcı arayüzü dahil.

<!-- kpi-11-exempt: kuralın uygulanma biçimini tarif eden metin -->

Bu kural CI'da otomatik denetlenir: `trusted-local` / `trusted local` / `TrustedLocal` ifadelerinin yakınında `sandbox` kelimesi geçerse build kırılır (`scripts/check-docs.mjs`).

Fuzzy bir olumsuzlama kelime listesi kaçınılmaz olarak eksik kalır. Bu yüzden kuralın kendisini tartışan metinler için insan tarafından yazılmış, greplenebilir bir muafiyet işareti kullanılır: `<!-- kpi-11-exempt: neden -->`. Muafiyet sayısı her CI koşusunda raporlanır; sessizce çoğalamaz.

### 2. Zorunlu limitation ifadesi

Same-JVM sınırı, [`../security/guarantees.md`](../security/guarantees.md) içinde açık bir cümle olarak bulunmak **zorundadır** ve bu cümlenin varlığı CI'da kontrol edilir:

> Bridge auth, aynı Paper JVM'i içinde çalışan aktif kötü niyetli hedef plugin'e karşı tam güvenlik sınırı değildir.

### 3. Garanti sınıflandırması

Her güvenlik ifadesi üç kategoriden birine girmek zorundadır:

| Kategori | Gereklilik |
|---|---|
| **Sağlar** | Bir test kimliğine bağlı olmalı |
| **Sağlamaz** | Açık bir limitation cümlesi olmalı |
| **Tespit eder (önlemez)** | İkisi ayrı ayrı yazılmalı — "tespit" asla "önleme" gibi sunulamaz |

Üçüncü kategori özellikle evidence integrity için geçerlidir: host tarafında hesaplanan checksum, kötü niyetli plugin'in evidence değiştirmesini **tespit eder**, engellemez.

### 4. Agent yetkileri

- Agent-facing destructive tool V1'de yoktur (`allow_agent_destructive_tools: false`, config'de sabit).
- R3/R4 risk seviyesindeki capability'ler `exposure.developer_tool: false` olmak zorundadır — `scripts/validate-registry.mjs` bunu denetler.
- T3 (host escape) ve T4 (production) için hiçbir iddia yapılmaz.

### 5. Kanıt bütünlüğü caveat'ı

Hedef plugin aktif saldırgan kabul edildiğinde tam kanıt bütünlüğü **garanti edilmez**. Raporlar bu caveat'ı `known_limitations` alanında taşır.

## Alternatifler

<!-- kpi-11-exempt: reddedilen alternatifler tablosu -->

| Alternatif | Neden reddedildi |
|---|---|
| Trusted Local'ı "hafif sandbox" diye adlandırmak | Kullanıcı, olmayan bir izolasyona güvenir; ürünün ana vaadi yanlış temele oturur |
| Same-JVM limitation'ını yalnızca teknik ekte belirtmek | Limitation'ın görünürlüğü zamanla kaybolur; ana güvenlik belgesinde olmalı |
| Bridge'i ayrı process'e taşıyıp sınırı gerçekten kurmak | Paper API erişimi yalnızca Paper JVM'inden mümkün; ayrı process aynı sınırı yine gerektirir (bkz. ADR-0001) |
| Kuralı yalnızca review'a bırakmak | Uzun vadede kaçınılmaz olarak ihlal edilir; otomatik gate şart |

## Sonuçlar

**Olumlu**

- Kullanıcı, güvendiği şeyin ne olduğunu doğru biliyor.
- Güvenlik iddiaları test kimliklerine bağlı ve denetlenebilir.
- Dokümantasyon sulanmasına karşı otomatik koruma var.

**Olumsuz**

- Pazarlama dili kısıtlanır: "sandboxed" gibi güçlü kelimeler kullanılamaz.
- T2 kullanıcıları için Container zorunluluğu ek kurulum yükü getirir.
- Yasaklı ifade taraması yanlış pozitif üretebilir (örn. bu ADR'ın kendisi) → tarama, yasağı *açıklayan* bağlamı allowlist'lemek zorundadır.

**Kanıt:** DOC-GATE-06, `ST-SAMEJVM-001`, `ST-SAMEJVM-002`, `scripts/check-docs.mjs`, `scripts/validate-registry.mjs`.

## İlgili

- [`../security/threat-model.md`](../security/threat-model.md)
- [`../security/guarantees.md`](../security/guarantees.md)
- [`../delivery/spikes/SPIKE-SAME-JVM-THREAT-001.md`](../delivery/spikes/SPIKE-SAME-JVM-THREAT-001.md)
- [`../delivery/beyond-v1.md`](../delivery/beyond-v1.md)
