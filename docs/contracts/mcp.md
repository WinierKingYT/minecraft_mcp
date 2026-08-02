# MCP sözleşmesi

Karar kayıtları: [ADR-0002](../adr/0002-mcp-stdio-transport.md) (taşıma) · [ADR-0008](../adr/0008-stateless-protocol-and-stable-sdk.md) (stateless yüzey)
Profil: `mcp.protocol_version` — [`../../compatibility/paper-26.2-build-84-v1.yaml`](../../compatibility/paper-26.2-build-84-v1.yaml)

## Stateless çekirdek

Protokol revizyonu `2026-07-28` **stateless**tır. Bu, ürünü doğrudan etkileyen kırıcı bir değişikliktir:

| Öğe | Durum |
|---|---|
| `initialize` / `notifications/initialized` | **Kaldırıldı** |
| `Mcp-Session-Id` | **Kaldırıldı** |
| Oturum durumu | Sunucuda tutulmaz |
| İstemci bağlamı | Her istekte `params._meta` |
| Capability keşfi | **Opsiyonel** `server/discover` |
| Liste sonuçları | `ttlMs` + `cacheScope` ile önbelleklenebilir |
| Uzun etkileşim | Multi Round-Trip Requests (`resultType: "input_required"`) |
| Legacy HTTP+SSE | Deprecated (V1 zaten yalnızca `stdio`) |

Kaldırılmış metotlar **sessizce yok sayılmaz**: `-32601` ve nedenini açıklayan bir mesaj döner. Sessiz kabul, eski bir istemcinin el sıkışmanın başarılı olduğunu sanmasına yol açardı.

`_meta` içindeki protokol sürümü sunucununkinden farklıysa istek **reddedilmez**, uyarı loglanır — spec toleranslı sunucu bekler.

## `stdio` bütünlüğü

```text
stdout    -> yalnızca MCP JSON-RPC mesajları
stderr    -> operational log
file sink -> structured JSON log
```

`console.log` benzeri stdout loglama **yasaktır**. Bu kural bir konvansiyon değil, test edilen bir invariant'tır:

> MCP Server stdout'undaki **her byte** JSON-RPC transport parser'ından geçebilmelidir.

Uygulama: `apps/mcp-server/src/transport/stdout-guard.ts` süreç başlangıcında `process.stdout.write` dışındaki tüm konsol yollarını `stderr`'e yönlendirir. Test: `CT-MCP-STDOUT-001`.

## Tool sonucu

Başarılı:

```json
{
  "resultType": "complete",
  "isError": false,
  "content": [
    { "type": "text", "text": "Plugin başarıyla başlatıldı." }
  ],
  "structuredContent": {
    "status": "success",
    "correlation_id": "cor_...",
    "data": { "run_id": "run_..." },
    "warnings": []
  }
}
```

Domain hatası:

```json
{
  "resultType": "complete",
  "isError": true,
  "content": [
    { "type": "text", "text": "Runtime çalışmıyor." }
  ],
  "structuredContent": {
    "status": "error",
    "correlation_id": "cor_...",
    "error": {
      "code": "RUNTIME_NOT_RUNNING",
      "retryable": false,
      "suggested_action": "Önce plugin_launch işlemini tamamlayın."
    }
  }
}
```

**Karar:** Bilinmeyen tool veya bozuk protokol isteği domain error'a **çevrilmez**; JSON-RPC protokol hatası olarak kalır. Aksi hâlde ajan, protokol seviyesindeki bir hatayı yeniden denenebilir bir domain durumu sanır.

Şemalar:

- [`../../packages/contracts/schemas/common/tool-result.schema.json`](../../packages/contracts/schemas/common/tool-result.schema.json)
- [`../../packages/contracts/schemas/common/tool-error.schema.json`](../../packages/contracts/schemas/common/tool-error.schema.json)

## Stabil tool listesi

| # | Kural |
|---|---|
| TL-01 | Tool listesi MCP Server başlangıç profiline göre belirlenir |
| TL-02 | Bir runtime'ın capability durumuna göre araçlar **kaybolmaz** |
| TL-03 | Runtime capability eksikse tool call `CAPABILITY_UNAVAILABLE` döndürür |
| TL-04 | Aynı profilde tool sırası **deterministik** olmalıdır |
| TL-05 | Tool list change notification yalnızca profile/config reload gibi açık değişiklikte kullanılır |

Gerekçe: dinamik olarak kaybolan tool'lar ajanın plan yapmasını imkânsızlaştırır ve istemci tarafında cache tutarsızlığı üretir. Eksik capability bir *çalışma zamanı durumu*dur, *şema değişikliği* değildir.

TL-05 artık ek bir anlam taşır: `tools/list` sonucu `ttlMs` ile önbelleklenebilir olduğundan, listenin yalnızca açık bir profil/config değişiminde değişmesi bir **doğruluk koşuludur**, sadece bir ergonomi tercihi değil. Runtime durumuna göre değişen bir liste, istemcinin önbelleğini sessizce yanlış hâle getirirdi.

Profiller ve tool listeleri: [`capability-registry.md`](capability-registry.md)

## Error catalog

Kayıt biçimi:

```yaml
code: RUNTIME_NOT_RUNNING
owner: runtime
category: state

tool_result:
  is_error: true
  retryable: false
  suggested_action: "Önce plugin_launch işlemini tamamlayın."

bridge_mapping:
  http_status: 409

json_rpc_mapping:
  protocol_error: false

redaction:
  profile: none
```

Kaynak: [`../../packages/error-catalog/errors/`](../../packages/error-catalog/errors/) — duplicate kod CI hatasıdır (DOC-GATE-04).

## Resources

```text
minecraft://run/{run_id}/status
minecraft://run/{run_id}/logs
minecraft://run/{run_id}/events
minecraft://run/{run_id}/report
minecraft://run/{run_id}/evidence
minecraft://operation/{operation_id}
minecraft://project/{project_id}/manifest
minecraft://runtime/{server_instance_id}/capabilities
minecraft://artifact/{build_artifact_id}
```

Kurallar:

- MIME type zorunlu
- Byte limit zorunlu
- Cursor/pagination zorunlu
- Ownership kontrolü zorunlu
- Redaction zorunlu
- TTL/retention açık
- Silinen resource `RESOURCE_NOT_FOUND` döndürür
- **Raw host path dışarı verilmez**
