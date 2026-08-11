# ADR-0010 — MCP SDK 2.0.0'a geçiş ve official-client conformance kapanışı

**Durum:** accepted
**Tarih:** 2026-08-11
**Supersedes:** [ADR-0008](0008-stateless-protocol-and-stable-sdk.md) — karar 3 (SDK bağımlılığı) ve protokol yüzeyi varsayımları
**Bağlam:** [`../delivery/spikes/SPIKE-MCP-SDK-2026-001.md`](../delivery/spikes/SPIKE-MCP-SDK-2026-001.md)

## Bağlam

ADR-0008, SDK 2.0.0'ın desteklediği en yüksek protokol revizyonunu `2025-11-25`
olarak tespit etmiş ve "SDK'ya geçiş, 2026-07-28 desteği geldiğinde" kararı
almıştı. Bu karar, alpha `.2`'nin sabitlerinden okunmuştu; **stable 2.0.0**
(2026-07-27) modern era (`2026-07-28`) negotiation'ı ve legacy shim
(`2025-11-25` initialize istemcileri) ile birlikte gelir. Canlı stdio
probe'larıyla doğrulandı: pin'li client, `server/discover` ile modern era'ya
bağlanır; legacy client'lar SDK shim'inden servis edilir.

## Karar

### 1. Protokol kabuğu official SDK'ya taşındı

`apps/mcp-server` artık dış protokol yüzeyini
`@modelcontextprotocol/server@2.0.0` üzerinden yönetir:

- `serveStdio(() => buildSdkServer(...))` — server örneği her bağlantıda
  üretilir (stateless, ADR-0008 çekirdeği değişmedi).
- Tool kaydı `registerTool(name, { title, description, inputSchema, outputSchema }, cb)`;
  handler dönüşü `resultType: 'complete'` + `content` + `structuredContent`
  + koşullu `isError: true` (SDK success yanıtında `isError` alanı taşımaz).
- Wire-level sorumluluklar (`server/discover`, `_meta` zarfı, era negotiation,
  legacy shim, cache hint'leri) SDK'ya aittir; `ToolFacade` domain katmanı
  dokunulmadan kaldı.

### 2. Eski custom transport yüzeyi silindi

`src/server.ts`, `src/transport/stdio-transport.ts`, `src/transport/types.ts`
kaldırıldı. `stdout-guard` daraltıldı: SDK'nın `StdioServerTransport`'u
stdout purity'yi sağlar; guard yalnızca `console.*` çıktılarını stderr'e
yönlendirir (eski `process.stdout.write` sarmalaması SDK yazımını bozuyordu).
`CT-MCP-STDOUT-001` doğrulaması bu yeni bölünmeyle geçer.

### 3. `cacheScope: "server"` terk edildi

SDK, `cacheScope` için yalnızca `'public' | 'private'` kabul eder; `'server'`
`RangeError` üretir (spec dışı). `tools/list` ve `server/discover` cache hint'leri
`ttlMs: 300000` + `cacheScope: 'private'` olarak yayınlanır.

### 4. Output şemaları self-contained yayınlanır

Ortak `tool-result.schema.json` şemasına mutlak `$ref` veren output şemaları,
SDK client'ının client-side output validator'ında (AJV) çözülemiyor — remote
`$ref` yüklenmez ve `callTool` `ProtocolError` üretir. Bu yüzden adapter
(`src/sdk/adapter.ts::buildToolResultOutputSchema`) şemaları `$defs`-gömülü,
self-contained biçimde yayınlar; `tool-result.schema.json` / `tool-error.schema.json`
kimlikleri `$defs` anahtarlarında korunur. `$defs` kopyası
`packages/contracts/schemas/common/` ile birebir senkron tutulur.

### 5. Conformance, official client ile kapanır

`test/conformance-official-client.test.ts` — 14 testlik kullanıcı onaylı matris,
`@modelcontextprotocol/client@2.0.0` (devDependency, test) ile gerçek stdio
sürecine karşı koşulur. #10 (canlı supervisor E2E) `mcpdev serve` launcher
(P0-7) sonrası ayrı koşulur. 2026-08-11 itibarıyla: **56/57 pass, 1 skip, 0 fail.**

## Alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| Custom transport'u koruyup SDK'yı yalnızca conformance için kullanmak | Wire yüzeyi iki kez implement edilmiş olur; SDK'nın sağladığı negotiation/shim garantileri kaybolur |
| Output şemalarını `$ref`-only bırakmak | SDK client'ı `listTools()` sonrası `callTool`'da `can't resolve reference` hatası üretir (davranış ortama göre değişken göründüğünden teşhisi zordur) |
| `structuredContent` yerine yalnızca text content yayınlamak | V1 kontratı structuredContent'i zorunlu kılar; legacy shim ayrıca `{ result: {...} }` sarmalı üretir (legacy testinde kapsanır) |
| SDK'sız kalmaya devam etmek | Stable SDK'nın modern era + legacy shim yüzeyi, custom implementasyonda iki kat eforla yeniden üretilmek zorunda kalırdı |

## Sonuçlar

**Olumlu**

- Protokol yüzeyi, SDK'nın test edilmiş negotiation/shim davranışına devredildi.
- Conformance matrisi official client ile koşulur (kullanıcı gereksinimi, P0-4).
- stdout purity invariant'ı SDK transport'u + daraltılmış guard ile garanti altında.

**Olumsuz**

- `cacheScope: 'server'` değeri wire'dan kalktı; kontrat dokümanı ve profil güncellendi.
- Adapter'ın `$defs` kopyası, `packages/contracts/schemas/common/` değiştiğinde
  elle senkron ister (senkron denetimi CI'ya eklenebilir).
- `stdout-guard`'ın eski `process.stdout.write` interception'ı kaldırıldı;
  SDK'ya güven söz konusudur (SDK yükseltmelerinde `CT-MCP-STDOUT-001` izler).

**Kanıt:** `test/conformance-official-client.test.ts`, `test/stdout-purity.test.ts`,
`test/v11-e2e.test.ts` — `corepack pnpm --dir apps/mcp-server run test`
(56/57, skip: canlı supervisor E2E).

## İlgili

- [ADR-0008](0008-stateless-protocol-and-stable-sdk.md)
- [`../contracts/mcp.md`](../contracts/mcp.md)
- [`../../compatibility/paper-26.2-build-84-v1.yaml`](../../compatibility/paper-26.2-build-84-v1.yaml)
- [SPIKE-MCP-SDK-2026-001](../delivery/spikes/SPIKE-MCP-SDK-2026-001.md)
