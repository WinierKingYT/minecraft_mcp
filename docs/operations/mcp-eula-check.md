# EULA akışı doğrulaması (operator yüzeyi)

> Durum: ✅ yeni akış (separation of authority) — `mcpdev eula accept` ile kabul; araç parametresi kaldırıldı.

EULA kabulü agent araç yüzeyinden **çıkarılmıştır** (separation of authority): agent kendi
adına EULA kabul edemez. Kabul yalnızca yerel operatör tarafından `mcpdev eula accept` ile
yapılır ve `~/.mcpdev/config/eula.json`'a (veya `$MCPDEV_DATA_DIR/config/eula.json`) yazılır.

## Zincir

```text
mcpdev eula accept                ── operator onayı (interaktif [y/N])
   └─ config/eula.json            ── { accepted: true, accepted_at, accepted_by } (mode 0600)
mcpdev serve (P0-7)               ── launcher: supervisor + mcp-server tek komutta
   └─ supervisor (start)          ── --eula-file (default: <data-dir>/config/eula.json)
        └─ createRuntimeImage     ── EULA kapısı: kabul yoksa EULA_NOT_ACCEPTED
             └─ mcp-server (stdio) ── tools/call scenario_run → IPC scenario.run → engine
```

Standalone koşumda supervisor aşağıdaki gibi başlatılır; `mcpdev serve` aynı
bayrakları içerir ve `--eula-file` için **varsayılanı kendisi bağlar**
(`$MCPDEV_DATA_DIR` veya `~/.mcpdev` altındaki `config/eula.json`).

## EULA kabulü (operator komutu)

```text
mcpdev eula status                 # kabul kaydını gösterir
mcpdev eula accept                 # interaktif [y/N]; kabul kaydını yazar
mcpdev eula accept --data-dir <dir>  # özel veri dizini (env: MCPDEV_DATA_DIR)
```

- Kabul `config/eula.json`'a atomik yazılır (tmp + rename, mode 0600).
- Dosya yoksa veya `accepted: true` değilse EULA kapısı kapalıdır.
- `MCPDEV_DATA_DIR` yoksa `~/.mcpdev` kullanılır.
- EULA metni: https://aka.ms/MinecraftEULA

## Supervisor'ı process olarak başlatma

`apps/run-supervisor/src/main.ts`: supervisor'ı standalone başlatır, named pipe endpoint'ini
kontrol dosyasına yazar, SIGINT/SIGTERM'de `server.close()` + kontrol dosyası temizliği yapar.

```text
node apps/run-supervisor/dist/src/main.js start \
  --repo-root <repo> --profile-id <id> --bridge-jar <path> --paper-cache <path> \
  [--runtime-root <dir>] [--project-id <id>] [--project-root <path>] [--evidence-dir <dir>] \
  [--eula-file <path>]
```

- `--eula-file` verilmezse **EULA kapısı kapalıdır**: her runtime oluşturma
  `EULA_NOT_ACCEPTED` ile reddedilir (güvenli-aynı kalır; hiçbir dosya oluşmaz).
- `--evidence-dir` verilirse evidence store bağlanır; `scenario_run` dönüşünde `evidence_ids` dolu gelir.
- İzolasyon için `MCPDEV_CONTROL_DIR` env'i kontrol dizinini taşır (varsayılan `%TEMP%/mcpdev-<user>`).

## Akış davranışı

1. **Kabul yoksa** (`eulaFile` yok / `accepted: true` değil / `eulaAccepted` demo opsiyonu kapalı):
   - Engine: `scenario.engine_error { error_code: "EULA_NOT_ACCEPTED" }`, status `failed`, kanıt 0.
   - Tool yüzeyi: `isError: true`, `error.code: EULA_NOT_ACCEPTED` (error catalog `runtime.yaml`'a ekli),
     catalog mesajı + `suggested_action` → "Kullanıcıdan `mcpdev eula accept` çalıştırmasını isteyin".
   - Hiçbir runtime dizini oluşmaz; runtime root boş kalır.
2. **Kabul varsa** → gerçek koşu:
   - Runtime image oluşur, Paper READY; scenario `completed`, assertion'lar passed.
   - Tool yüzeyi `success`: `evidence_ids`, `assertions[]` (step_name/passed/attempts/expected/actual).

Demo/gömülü kullanımlar (m0-smoke, m1-demo, m2a-demo, spike-hostile-probe) ürün yüzeyini
kullanmaz; `eulaAccepted: true` service opsiyonuyla operatör onayını **simüle** ederler.

## Hata kataloğu sözleşmesi

`EULA_NOT_ACCEPTED` `packages/error-catalog/errors/runtime.yaml`'da tanımlı:
`owner: runtime`, `category: permission`, `http_status: 403`, `retryable: false`.
Generated tipler (`errors.generated.ts`) `pnpm gen` ile yeniden üretilir.
DSL-12 kuralı korunur: tool yüzeyine çıkan her kod error catalog'da tanımlı olmalıdır.

## Testler

- `test/runtime-image.test.ts`: EULA kabul edilmeden runtime oluşturulamaz (`EULA_NOT_ACCEPTED`).
- `test/scenario-engine.test.ts`: `EULA_NOT_ACCEPTED` engine hatasının `errorCode` olarak sonuca taşındığı.
- `test/v11-tools.test.ts`: `scenario_run` failed → `EULA_NOT_ACCEPTED` catalog mesajı; errorCode'suz
  failed → `ASSERTION_FAILED`; success yanıtında `assertions` görünürlüğü.
- `apps/cli/test/eula.test.ts`: `mcpdev eula` — durum, interaktif onay, kayıt yazımı (0600),
  hayır cevabı, yeniden onay istememe, `MCPDEV_DATA_DIR` default'u.
