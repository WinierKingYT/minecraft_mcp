# MCP araç yüzeyi EULA akışı doğrulaması

> Durum: ✅ doğrulandı (`feat(m2a)` commit zinciri, `495a677` sonrası).

Bu kılavuz, `scenario_run` tool'unun `accept_minecraft_eula` akışının **MCP stdio araç yüzeyinden**
uçtan uca doğrulanmasını anlatır. MCP Inspector yerine gerçek JSON-RPC stdio istemcisi kullanılır
(same-codec, daha güçlü kanıt).

## Zincir

```text
mcpdev-supervisor start          ── SupervisorService + SupervisorIpcServer
   └─ control dosyası yazar        (MCPDEV_CONTROL_DIR/supervisor-endpoint.json)
        └─ mcp-server (stdio)      ── readControlFile ile named pipe'a bağlanır
             └─ tools/call scenario_run
                  └─ IPC scenario.run
                       └─ ScenarioEngine → disposable Paper runtime
```

## Supervisor'ı process olarak başlatma

`apps/run-supervisor/src/main.ts` (yeni): supervisor'ı standalone başlatır, named pipe endpoint'ini
kontrol dosyasına yazar, SIGINT/SIGTERM'de `server.close()` + kontrol dosyası temizliği yapar.

```text
node apps/run-supervisor/dist/src/main.js start \
  --repo-root <repo> --profile-id <id> --bridge-jar <path> --paper-cache <path> \
  [--runtime-root <dir>] [--project-id <id>] [--project-root <path>] [--evidence-dir <dir>]
```

- `--evidence-dir` verilirse evidence store bağlanır; `scenario_run` dönüşünde `evidence_ids` dolu gelir.
- İzolasyon için `MCPDEV_CONTROL_DIR` env'i kontrol dizinini taşır (varsayılan `%TEMP%/mcpdev-<user>`).

## Doğrulanan akış (canlı, gerçek Paper)

1. **`accept_minecraft_eula: false`** → `EULA_NOT_ACCEPTED`:
   - Engine: `scenario.engine_error { error_code: "EULA_NOT_ACCEPTED" }`, status `failed`, `duration_ms ≈ 150`, kanıt 0.
   - Tool yüzeyi: `isError: true`, `error.code: EULA_NOT_ACCEPTED` (error catalog `runtime.yaml`'a ekli —
     önceden katalog dışıydı ve `toolError` TypeError ile `SCENARIO_TIMEOUT`'a düşüyordu), catalog
     mesajı + `suggested_action` (accept_minecraft_eula'ya işaret eder).
   - Hiçbir runtime dizini oluşmaz; runtime root boş kalır.
2. **`accept_minecraft_eula: true`** → gerçek koşu:
   - Runtime image oluşur, Paper READY ~24 s; scenario `completed`, 3/3 assertion passed.
   - Tool yüzeyi `success`: `evidence_ids` (3), `assertions[]` (step_name/passed/attempts/expected/actual).

## Hata kataloğu sözleşmesi

`EULA_NOT_ACCEPTED` artık `packages/error-catalog/errors/runtime.yaml`'da tanımlı:
`owner: runtime`, `category: permission`, `http_status: 403`, `retryable: false`.
Generated tipler (`errors.generated.ts`) `pnpm gen` ile yeniden üretildi — toplam 113 hata kodu.
Bu, DSL-12 kuralını korur: tool yüzeyine çıkan her kod error catalog'da tanımlı olmalıdır.

## Testler

- `test/scenario-engine.test.ts`: `EULA_NOT_ACCEPTED` engine hatasının `errorCode` olarak sonuca taşındığı.
- `test/v11-tools.test.ts` (yeni): `scenario_run` failed → `EULA_NOT_ACCEPTED` catalog mesajı; errorCode'suz
  failed → `ASSERTION_FAILED`; success yanıtında `assertions` görünürlüğü.
