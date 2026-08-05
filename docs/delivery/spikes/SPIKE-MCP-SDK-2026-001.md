# SPIKE-MCP-SDK-2026-001 — MCP 2026 SDK ve protokol durumu

**Durum:** closed
**Blokladığı:** ADR-0002, V1 release gate
**Zaman kutusu:** 2–3 gün
**Kapanış tarihi:** 2026-08-03

## Cevaplanacak sorular

1. Profildeki `mcp.protocol_version` (`2026-07-28`) gerçekten yayınlanmış bir spec revizyonu mu? Draft mı, RC mi, stable mı?
2. `@modelcontextprotocol/server@2.0.0-alpha.2` ve `@modelcontextprotocol/node@2.0.0-alpha.2` npm registry'de mevcut mu? Yayın tarihi ve deprecation durumu ne?
3. Bu SDK'nın stdio transport API'si ne? `stdout`'a kendisi yazıyor mu, yoksa yazma noktası bize mi bırakılıyor?
4. Structured output (`structuredContent`) ve `resultType: "complete"` alanları SDK tarafından mı üretiliyor, bizim mi doldurmamız gerekiyor?
5. Tool list change notification API'si var mı?
6. Resources API'si cursor/pagination ve MIME type'ı destekliyor mu?
7. Stable 2.x için ilan edilmiş bir takvim var mı?
8. MCP Inspector'ın bu protokol revizyonuyla uyumlu sürümü hangisi?

## Neden kritik

V1 release'i açık biçimde bu SDK'nın stable sürümüne bağlanmıştır. Aynı zamanda **stdout purity** invariant'ı (bkz. [`../../contracts/mcp.md`](../../contracts/mcp.md)) SDK'nın stdout davranışına bağlıdır: SDK kendi log'unu stdout'a yazıyorsa invariant SDK içinde kırılır ve bizim guard'ımız yetmez.

## Deney planı

1. Spec revizyon listesini ve blog duyurusunu doğrula.
2. `npm view` ile paket varlığını, sürümlerini ve yayın tarihlerini kontrol et.
3. Minimal bir stdio server yaz; `initialize` → `tools/list` → `tools/call` akışını Inspector ile geçir.
4. Süreç boyunca stdout'un her byte'ını yakala ve JSON-RPC parser'ından geçir.
5. SDK'yı **kullanmayan** kendi transport implementasyonumuzla aynı akışı tekrarla ve iki sonucu karşılaştır.

## Geçici karar (bootstrap sırasında alınmış)

Prototip aşamasında **SDK'ya bağımlılık kurulmamıştır**. `apps/mcp-server` kendi minimal stdio JSON-RPC framing'ini `TransportAdapter` arayüzü arkasında uygular (`compatibility` profilinde `mcp.sdk_prototype.linked: false`).

Gerekçe:

- SDK'nın varlığı ve API'si doğrulanmadan ona bağlanmak, doğrulanamayan bir bağımlılığı temel katmana koymak olurdu.
- `TransportAdapter` seam'i, stable SDK seçildiğinde tool handler'larını değiştirmeden geçiş yapmayı sağlar.
- stdout purity invariant'ı böylece kendi kontrolümüzde kalır.

Bu geçici karar, spike sonucuyla ya onaylanacak ya da ADR-0002'de revize edilecektir.

## Çıkış kararı

| Sonuç | Karar |
|---|---|
| Stable 2.x mevcut ve stdout'a yazmıyor | SDK'ya geç, `TransportAdapter`'ı SDK üzerine implement et, `linked: true` |
| Yalnızca alpha mevcut | Prototip kanalında kal; kendi transport'u koru; V1 gate açık kalır |
| Protokol revizyonu farklı çıkıyor | Profili düzelt, ADR-0002'yi revize et, conformance suite'i yeniden yaz |
| SDK stdout'a yazıyor | SDK'yı kullanma veya stdout'u yeniden yönlendiren bir shim yaz; kararı ADR'a bağla |

## Bulgular

### 1. Protokol revizyonu `2026-07-28` gerçektir

`https://modelcontextprotocol.io/specification/2026-07-28` HTTP 200 döndürür ve `schema/2026-07-28/schema.ts` referansı taşır. Profildeki `mcp.protocol_version: 2026-07-28` doğru bir spec revizyonudur.

### 2. SDK sürümü ve deprecation

`@modelcontextprotocol/server@2.0.0` ve `@modelcontextprotocol/node@2.0.0` npm'de **stable** (`dist-tags.latest: 2.0.0`), **2026-07-27T23:55Z**'de yayınlanmış, deprecation yok. Spike'ın varsaydığı `alpha.2` artık geçersiz — stable mevcut.

### 3. stdout davranışı (kritik)

SDK, `StdioServerTransport` ile **kendi stdin/stdout'una** bağlanır. SDK kaynak kodunda `console.warn` ×6 ve `console.log` ×2 vardır (örn. zod uyumsuzluğu, tool adı validasyon uyarıları) — bu çağrılar stdout'a JSON-RPC olmayan baytlar karıştırabilir.

**Ancak** `serveStdio(factory, { transport })` BYO (bring-your-own) transport destekler: kendi `Transport` implementasyonumuzu verirsek SDK yazım noktasına dokunmaz ve stdout purity invariant'ı (bkz. `docs/contracts/mcp.md`) korunur. Deneysel kanıt: minimal probe server çalıştırıldığında stdout yalnızca JSON-RPC satırları taşıdı, `console.error` stderr'de kaldı.

### 4. `structuredContent` / `resultType`

SDK bunları üretmez ama **passthrough** eder. `registerTool` handler'ından `{ content, structuredContent, resultType: 'complete' }` dönünce response'a aynen taşındı (deneysel kanıt: `{"result":{"content":[...],"structuredContent":{"ok":true},"resultType":"complete"}}`). Mevcut ürün facade'i (`apps/mcp-server/src/tools/facade.ts:71`) aynı şekli üretir — uyumlu.

### 5. Tool list change notification

`capabilities.tools.listChanged: true` initialize yanıtında döner; SDK `notifications/list_changed` gönderimini destekler (tip yüzeyinde 14 referans).

### 6. Resource pagination

`cursor` / `nextCursor` tipleri SDK'da mevcut (10+6 referans); resource listeleme ve okuma cursor tabanlıdır.

### 7. Stable takvim

Stable `2.0.0` **yayınlanmıştır** (2026-07-27) — beklemeye gerek yok.

### Kritik uyumsuzluk: protokol revizyonu

SDK'nın protokol sabitleri (deneysel import):

```text
LATEST_PROTOCOL_VERSION:       2025-11-25
DEFAULT_NEGOTIATED:            2025-03-26
SUPPORTED:                     2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07
```

`2026-07-28` **destek listesinde yoktur** (koddaki 76 referans yalnızca hata mesajlarındaki forward-compat bilgileridir: "servers implementing protocol revision 2026-07-28 MUST include resultType"). initialize'de `2026-07-28` istendiğinde SDK `2025-11-25` yanıtlar. `2026-07-28`'de zorunlu yeni kurallar (örn. `_meta` zarfı, zorunlu `resultType`) SDK'da yalnızca uyarıcı olarak kodlanmıştır.

## Sonuç

**Stable 2.0.0 SDK mevcuttur; `structuredContent`/`resultType`/`listChanged`/pagination desteklenir; stdout invariant'ı BYO transport ile korunabilir. Fakat SDK'nın en yüksek desteklediği protokol revizyonu `2025-11-25`'tir — profildeki `2026-07-28` revizyonunu henüz desteklemez.**

Karar (ADR-0002 kapsamında): **geçici karar onaylanır — kendi transport'u (`TransportAdapter`) korunur**, SDK'ya geçiş bir sonraki SDK sürümü `2026-07-28` desteği eklediğinde yapılır; o noktada `mcp.sdk_prototype.linked: true` olur ve `TransportAdapter` SDK üzerine implement edilir. V1 release gate'i bu nedenle açık kalır; engel değil gecikmedir. SPIKE **closed**.
