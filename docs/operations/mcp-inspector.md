# MCP Inspector ile yerel doğrulama

Inspector, KPI-10'un iki ayağından biridir (diğeri seçilen gerçek istemci). M0 kabul kriteri: **Inspector geçer**.

## Ön koşullar

```bash
pnpm install && pnpm run gen && pnpm run build
```

`pnpm run gen` olmadan `@mcpdev/generated-types` boştur ve sunucu başlamaz — bu bilinçlidir: tool listesi capability registry'den üretilir, elle tutulan bir liste yoktur.

## Sunucuyu doğrudan çalıştırma

```bash
MCPDEV_ROOT="$PWD" node apps/mcp-server/dist/index.js
```

Windows PowerShell:

```bash
$env:MCPDEV_ROOT = $PWD; node apps/mcp-server/dist/index.js
```

Sunucu `stdio` üzerinde konuşur. Elle deneme için satır sonlandırmalı JSON-RPC yazın:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | MCPDEV_ROOT="$PWD" node apps/mcp-server/dist/index.js
```

## Inspector

Inspector'ın uyumluluk profilindeki protokol revizyonunu destekleyen sürümü `SPIKE-MCP-SDK-2026-001` ile belirlenir. Sürüm sabitlenene kadar buraya sabit bir komut yazılmaz (DOC-GATE-02: doğrulanmamış bir sürümü doğrulanmış gibi sunmak yasaktır).

Spike kapandığında bu bölüme şunlar eklenecektir:

- Pinlenmiş Inspector sürümü ve çağırma komutu
- Beklenen `initialize` yanıtı
- Beklenen tool sayısı ve sırası

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `MCPDEV_ROOT` | `process.cwd()` | Uyumluluk profilinin okunacağı repository kökü |
| `MCPDEV_TOOL_PROFILE` | `developer` | `developer` \| `debug` \| `scenario-authoring` |
| `MCPDEV_LOG_LEVEL` | `INFO` | `ERROR` \| `WARN` \| `INFO` \| `DEBUG` |
| `MCP_PROTOCOL_VERSION` | profil değeri | Yalnızca spike/deneme için geçersiz kılma |

Bilinmeyen bir `MCPDEV_TOOL_PROFILE` değeri sessizce yok sayılmaz: uyarı loglanır ve varsayılan profile düşülür.

## stdout saflığı

Sunucunun stdout'undaki **her byte** JSON-RPC parser'ından geçmelidir. Guard iki katman uygular:

1. Tüm `console.*` çağrıları `stderr`'e yönlendirilir.
2. `process.stdout.write` yalnızca protokol yazıcısı üzerinden çalışır; başka bir çağrı **yazılmaz**, `stderr`'e ihlal kaydı düşer.

İhlal sayacı kapanışta loglanır:

```json
{"level":"INFO","component":"mcp-server","event":"server.shutdown","signal":"SIGTERM","stdout_violations":0}
```

`stdout_violations` sıfırdan büyükse bir kod yolu stdout'a yazmayı denemiş demektir — bu bir hata olarak ele alınmalıdır.

Otomatik test: `CT-MCP-STDOUT-001` — [`apps/mcp-server/test/stdout-purity.test.ts`](../../apps/mcp-server/test/stdout-purity.test.ts)

## Beklenen davranışlar

| Senaryo | Beklenen |
|---|---|
| `tools/list` iki kez çağrılır | Aynı sıra, aynı içerik (TL-04) |
| Uygulanmamış bir tool çağrılır | `isError: true`, `CAPABILITY_UNAVAILABLE`, tool listede **kalır** (TL-02, TL-03) |
| Bilinmeyen method | JSON-RPC `-32601`; domain error'a çevrilmez |
| Bozuk JSON | JSON-RPC `-32700`; sonraki istek normal işlenir |
| `system_capabilities` | Profil `unverified` iken `warnings` dolu, `known_limitations` mevcut |
