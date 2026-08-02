# Bridge protokolü

Protokol sürümü: `bridge: 1`

## Bağlantı

| # | Kural |
|---|---|
| BR-01 | Loopback bind |
| BR-02 | Rastgele uygun port |
| BR-03 | Her runtime için farklı token |
| BR-04 | Handshake dosyasında port ve protocol metadata |
| BR-05 | **Secret handshake dosyasında bulunmaz** |
| BR-06 | Host, Origin, Content-Type ve body size doğrulaması |
| BR-07 | Bounded worker queue |
| BR-08 | Mutation için idempotency key |
| BR-09 | Correlation ve causation ID |

Güven sınırı ve limitationlar: [`../security/guarantees.md`](../security/guarantees.md)

## Endpoint'ler

```text
GET  /v1/health
GET  /v1/capabilities
POST /v1/query
POST /v1/action
GET  /v1/events?boot_id=<id>&after=<sequence>&limit=<n>
```

## Request

```json
{
  "request_id": "req_...",
  "correlation_id": "cor_...",
  "causation_id": "op_...",
  "run_id": "run_...",
  "server_instance_id": "srv_...",
  "bridge_boot_id": "boot_...",
  "operation": "world.get_block",
  "idempotency_key": null,
  "timeout_ms": 2000,
  "arguments": {
    "world_key": "minecraft:overworld",
    "x": 10,
    "y": 64,
    "z": 10
  }
}
```

## Response

```json
{
  "request_id": "req_...",
  "correlation_id": "cor_...",
  "ok": true,
  "server_instance_id": "srv_...",
  "bridge_boot_id": "boot_...",
  "server_tick": 4812,
  "data": { "material": "minecraft:stone" },
  "warnings": []
}
```

## Capability manifest

```json
{
  "bridge_version": "0.1.0",
  "bridge_protocol": 1,
  "paper_version": "26.2",
  "paper_build": 84,
  "java_version": 25,
  "server_instance_id": "srv_...",
  "bridge_boot_id": "boot_...",
  "folia": false,
  "operations": {
    "world.get_block": {
      "risk": "R0",
      "max_timeout_ms": 2000
    },
    "world.set_block": {
      "risk": "R2",
      "requires_idempotency": true,
      "allowed_regions": ["fixture-area"]
    }
  },
  "events": [
    "server.ready",
    "plugin.enabled",
    "plugin.disabled",
    "player.join",
    "player.quit",
    "player.command",
    "block.place",
    "block.break",
    "bridge.action.started",
    "bridge.action.completed",
    "bridge.action.failed"
  ]
}
```

## Thread modeli

| # | Kural |
|---|---|
| TH-01 | HTTP parsing/auth worker thread'de |
| TH-02 | Paper API işlemleri uygun scheduler'da |
| TH-03 | Disk ve network I/O main thread dışında |
| TH-04 | Mutation run başına seri kuyruğa alınır |
| TH-05 | Timeout ana thread'de kontrolsüz görev bırakmamalıdır |
| TH-06 | Queue doluysa `BRIDGE_BUSY` |
| TH-07 | Read-only sınırlı retry edilebilir |
| TH-08 | **Mutation kör retry edilemez** |

TH-05 kritiktir: main thread'de terk edilmiş bir görev, timeout sonrası "iptal edildi" sanılan bir mutation'ı geç uygulayarak scenario determinizmini bozar.
