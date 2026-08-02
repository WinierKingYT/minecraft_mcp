# Yapılandırma sözleşmesi

Sürüm: `config_schema: 1`
Şema: [`../../packages/config-schema/schema/config.schema.json`](../../packages/config-schema/schema/config.schema.json)
Örnek: [`../../packages/config-schema/config.example.yaml`](../../packages/config-schema/config.example.yaml)

## Kurallar

| # | Kural |
|---|---|
| CF-01 | JSON Schema doğrulaması zorunlu |
| CF-02 | Bilinmeyen property **hata üretir** (`additionalProperties: false`) |
| CF-03 | Secret config içinde düz metin tutulmaz |
| CF-04 | Windows ve Linux path davranışı ayrı test edilir |
| CF-05 | Config migration versioned olmalıdır |
| CF-06 | **Güvensiz default bulunmaz** |
| CF-07 | Agent destructive tool V1'de kapalıdır |
| CF-08 | Config reload tool list değiştirirse açık notification üretir |

CF-02 gerekçesi: sessizce yok sayılan bir yazım hatası, kullanıcının etkinleştirdiğini sandığı bir güvenlik kontrolünün kapalı kalması demektir.

## Güvenli default'lar

Aşağıdaki alanlar, config dosyasında belirtilmediğinde **kısıtlayıcı** yöne düşer:

| Alan | Default | Neden |
|---|---|---|
| `execution.container.network_default` | `none` | Ağ erişimi açık onay gerektirir |
| `build.default_mode` | `reproducible` | Provisioning kullanıcı onayı ister |
| `security.allow_agent_destructive_tools` | `false` | V1'de sabit |
| `runtime.max_concurrent` | `1` | Kaynak tükenmesi ve determinizm |
| `projects.*.default_backend` | `container` | Daha güçlü izolasyon |
| `telemetry.redact_patterns` | token/secret/password/Authorization | Sızıntı önleme |
