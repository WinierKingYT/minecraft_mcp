# Gözlemlenebilirlik

## Structured log

```json
{
  "level": "INFO",
  "component": "run-supervisor",
  "event": "runtime.ready",
  "correlation_id": "cor_...",
  "run_id": "run_...",
  "operation_id": "op_...",
  "server_instance_id": "srv_...",
  "duration_ms": 18342
}
```

Hedefler:

| Hedef | Kural |
|---|---|
| `stdout` (MCP Server) | **Yalnızca JSON-RPC** |
| `stderr` | Operational log |
| File sink | Structured JSON log |

## Zorunlu metrikler

| Kategori | Metrik |
|---|---|
| MCP | tool call count, error rate, p50/p95/p99 |
| Build | duration, failure rate |
| Runtime | Paper startup duration, runtime crash, orphan recovery |
| Cleanup | cleanup failure |
| Container | quota failure |
| Bridge | queue depth, timeout, event drop |
| Scenario | pass/fail, flaky rate |
| Evidence | write failure, storage size |
| Paper | TPS / MSPT |

## Trace

```text
MCP call
  -> schema validation
    -> policy
      -> application service
        -> Supervisor IPC
          -> execution backend
            -> Bridge request
              -> scheduler task
                -> Paper API
                  -> event/evidence
```

`correlation_id` bu zincirin tamamında taşınır; `causation_id` bir event'in hangi mutation'dan doğduğunu gösterir.

## Redaction

Maskelenen alanlar: Authorization · token · secret file içeriği · host credential · veritabanı credential · gereksiz environment variable · gereksiz absolute path · IP · oyuncu chat'i · kişisel veri.

Ayrıntı: [`../security/controls.md`](../security/controls.md)

## Stdout testi

> MCP Server stdout'undaki **her byte** JSON-RPC transport parser'ından geçebilmelidir.

Test: `CT-MCP-STDOUT-001`. Bu test CI'da her PR'da koşar ve tek bir kaçak `console.log`'u yakalar.
