# SPIKE-MCP-SDK-2026-001 — MCP 2026 SDK ve protokol durumu

**Durum:** open
**Blokladığı:** ADR-0002, V1 release gate
**Zaman kutusu:** 2–3 gün

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

_(spike sırasında doldurulur)_

## Sonuç

_(bir cümlelik karar + ADR bağlantısı)_
