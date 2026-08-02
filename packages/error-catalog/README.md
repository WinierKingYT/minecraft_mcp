# Error Catalog

Hata kodlarının **tek gerçek kaynağı**. TypeScript birliği, Java enum'u ve dokümantasyon tabloları buradan üretilir.

```text
schema/error.schema.json              Tek kayıt şeması
schema/error-catalog-file.schema.json Dosya kabı şeması
errors/<owner>.yaml                   Sahibe göre gruplanmış kayıtlar
```

Bir dosyadaki tüm kayıtların `owner` alanı dosya adıyla eşleşmelidir.

## Değişmez kurallar

1. **Duplicate kod yasaktır** — tüm dosyalar arasında (DOC-GATE-04).
2. Her kayıt `tool_result.suggested_action` taşımak zorundadır (KPI-08). Boş veya genel ("tekrar deneyin") bir aksiyon kabul edilmez.
3. `json_rpc_mapping.protocol_error: true` olan kodlar domain error'a **çevrilmez**; bunlar bilinmeyen tool / bozuk istek gibi protokol seviyesi hatalarıdır.
4. `redaction.profile: none` yalnızca hiçbir hassas alan içermeyen hatalar için kullanılabilir.
5. `tool_result.retryable: true` olan bir kod, mutation üreten bir capability tarafından **kör retry** gerekçesi olarak kullanılamaz (`MUTATION_UNKNOWN_OUTCOME` her zaman `retryable: false`).
6. Capability kayıtlarının `errors` listesindeki her kod burada mevcut olmalıdır; tersi gerekmez (bazı kodlar yalnızca Bridge veya Supervisor iç akışında üretilir).

## Sahipler

| Dosya | Owner | Konu |
|---|---|---|
| [`errors/mcp.yaml`](errors/mcp.yaml) | `mcp` | Protokol, handle sahipliği, resource, limit |
| [`errors/supervisor.yaml`](errors/supervisor.yaml) | `supervisor` | IPC, operation, process ownership, cleanup |
| [`errors/project.yaml`](errors/project.yaml) | `project` | Kayıt, trust, path, snapshot |
| [`errors/build.yaml`](errors/build.yaml) | `build` | Build yürütme, artifact, backend |
| [`errors/gradle.yaml`](errors/gradle.yaml) | `gradle` | Wrapper, lock, verification, repository |
| [`errors/runtime.yaml`](errors/runtime.yaml) | `runtime` | Runtime yaşam döngüsü, port, ready gate |
| [`errors/bridge.yaml`](errors/bridge.yaml) | `bridge` | Bridge auth, queue, timeout, event cursor, idempotency |
| [`errors/plugin.yaml`](errors/plugin.yaml) | `plugin` | plugin.yml, test contract, permission provider |
| [`errors/scenario.yaml`](errors/scenario.yaml) | `scenario` | DSL doğrulama, assertion, timeout |
| [`errors/actor.yaml`](errors/actor.yaml) | `actor` | Protocol test actor |
| [`errors/evidence.yaml`](errors/evidence.yaml) | `evidence` | Evidence yazma, bütünlük, quota |
| [`errors/security.yaml`](errors/security.yaml) | `security` | Archive, output limit, environment |
| [`errors/config.yaml`](errors/config.yaml) | `config` | Yapılandırma ve uyumluluk profili |
