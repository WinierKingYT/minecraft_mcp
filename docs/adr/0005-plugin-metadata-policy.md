# ADR-0005 — `plugin.yml` resmî, `paper-plugin.yml` deneysel

**Durum:** accepted
**Tarih:** 2026-07-29
**Bağlam:** D0A kararı; [`../contracts/plugin-test-contract.md`](../contracts/plugin-test-contract.md)

## Bağlam

Paper iki plugin metadata biçimini destekliyor: klasik `plugin.yml` ve deneysel `paper-plugin.yml`. İkincisi farklı bir yükleme modeli, farklı bootstrap ve farklı dependency semantiği taşıyor. Ürünün plugin keşif katmanı bu iki biçimi eşit desteklerse:

- iki ayrı yükleme sırası modeli test edilmeli,
- iki biçim birlikte bulunduğunda öncelik kuralı gerekli,
- deneysel biçimdeki Paper tarafı değişiklikler ürünün keşif katmanını sürekli kırar.

## Karar

V1'in **resmî** desteği klasik `plugin.yml` içindir.

```yaml
plugin_metadata_support:
  plugin.yml:
    status: supported
    default: true
  paper-plugin.yml:
    status: experimental
    default: false
    enable_with_feature_flag: true
  both_present:
    status: supported
    precedence: explicit_manifest_policy
```

Feature flag kapalıyken `paper-plugin.yml` bulunan bir proje `PAPER_PLUGIN_EXPERIMENTAL_DISABLED` döndürür — sessizce yok sayılmaz.

İki biçim birlikte bulunduğunda öncelik **açık manifest politikası** ile belirlenir; örtük bir "hangisi daha yeniyse" kuralı yoktur.

## Alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| İkisini eşit desteklemek | İki yükleme modeli için ayrı test matrisi; deneysel API kırılmaları V1 stabilitesini tehdit eder |
| `paper-plugin.yml`'i tamamen reddetmek | Bu biçimi kullanan projeler hiç test edilemez; extension point bırakmamak V1.1'i zorlaştırır |
| Feature flag olmadan otomatik algılama | Kullanıcı, deneysel bir yolun etkinleştiğini bilmez; hata teşhisi belirsizleşir |
| Örtük öncelik kuralı | İki manifest'in çeliştiği durumda hangi metadata'nın kullanıldığı raporda kanıtlanamaz |

## Sonuçlar

**Olumlu**

- V1 test matrisi tek yükleme modeli üzerinde kalır.
- Deneysel biçim için extension point mevcut (V1.1 adayı).
- Kullanıcı, desteklenmeyen bir yola girdiğinde açık hata alır.

**Olumsuz**

- `paper-plugin.yml` kullanan projeler V1'de feature flag olmadan test edilemez.
- İki biçim için ayrı doğrulama kod yolu, flag açıldığında bakım yükü getirir.

**Kanıt:** `CT-PLUGIN-METADATA-001..003`, `PAPER_PLUGIN_EXPERIMENTAL_DISABLED` hata testi.

## İlgili

- [`../contracts/plugin-test-contract.md`](../contracts/plugin-test-contract.md)
- [`../../compatibility/paper-26.2-build-84-v1.yaml`](../../compatibility/paper-26.2-build-84-v1.yaml)
