# ADR-0002 — MCP `stdio` taşıması ve SDK bağımlılığı

**Durum:** kısmen superseded by [ADR-0008](0008-stateless-protocol-and-stable-sdk.md)
**Tarih:** 2026-07-29
**Bağlam:** REQ-007; [`../delivery/spikes/SPIKE-MCP-SDK-2026-001.md`](../delivery/spikes/SPIKE-MCP-SDK-2026-001.md)

> **2026-07-30 notu.** Bu ADR'nin **(a) taşıma** kararı geçerliliğini korur: V1 yalnızca yerel `stdio` destekler ve stdout purity invariant'ı yürürlüktedir.
>
> **(b) SDK bağımlılığı** kararının gerekçesi çürütülmüştür: protokol revizyonu `2026-07-28` final olarak yayınlanmış, stable `@modelcontextprotocol/server@2.0.0` çıkmış ve revizyon `initialize` el sıkışmasını kaldırmıştır. Yerine geçen karar: [ADR-0008](0008-stateless-protocol-and-stable-sdk.md).

## Bağlam

Ürün yerel bir geliştirme aracıdır ve V1'de uzak taşıma, OAuth veya çok kullanıcılı erişim hedeflemez. Aynı zamanda uyumluluk profili protokol revizyonu `2026-07-28` ve `@modelcontextprotocol/server@2.0.0-alpha.2` alpha SDK'sını işaret ediyor; ikisi de repository bootstrap sırasında **doğrulanamadı**.

İki ayrı karar gerekiyor: (a) taşıma, (b) SDK bağımlılığı.

## Karar

### (a) Taşıma

V1 yalnızca yerel **`stdio`** taşımasını destekler. Remote Streamable HTTP ve OAuth V2 adayıdır. MCP Tasks extension V1'de kapalıdır.

`stdio` bütünlüğü mutlak bir invariant'tır:

```text
stdout    -> yalnızca MCP JSON-RPC mesajları
stderr    -> operational log
file sink -> structured JSON log
```

Bu bir konvansiyon değil, test edilen bir kuraldır: MCP Server stdout'undaki **her byte** JSON-RPC parser'ından geçebilmelidir (`CT-MCP-STDOUT-001`).

### (b) SDK bağımlılığı

Prototip aşamasında **resmî SDK'ya bağımlılık kurulmaz.** `apps/mcp-server` kendi minimal JSON-RPC framing'ini bir `TransportAdapter` arayüzü arkasında uygular. Profilde `mcp.sdk_prototype.linked: false`.

Public V1 release'i, protokol `2026-07-28` destekleyen **stable** bir 2.x SDK seçilip uyumluluk testinden geçirilip pinlenene kadar **bloklanmıştır**. Alpha SDK referans edildiği sürece ürün `prototype` kanalından çıkamaz.

## Alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| Alpha SDK'ya hemen bağlanmak | Varlığı ve API'si doğrulanmamış bir paketi temel transport katmanına koymak; alpha API kırılmaları tüm tool handler'larını etkiler |
| Remote HTTP'yi V1'e almak | Auth, TLS, çok kullanıcılı yetkilendirme ve ağ tehdit modeli gerektirir; V1 non-goal'ü |
| stdout'a log yazıp istemcinin filtrelemesini beklemek | Protokolü kırar; istemci davranışına bağımlı; test edilemez |
| SDK'yı doğrudan kullanıp adapter yazmamak | Stable sürüme geçişte tüm handler'ların yeniden yazılması gerekir |

## Sonuçlar

**Olumlu**

- Transport katmanı doğrulanmamış bir bağımlılık taşımaz.
- stdout purity invariant'ı tamamen bizim kontrolümüzde.
- Stable SDK geldiğinde yalnızca `TransportAdapter` implementasyonu değişir.

**Olumsuz**

- JSON-RPC framing'i, `initialize` handshake'i ve capability negotiation'ı kendimiz uygulamak zorundayız — bu, spec uyumsuzluğu riski taşır ve Inspector ile doğrulanması şarttır.
- SDK'nın sağladığı ileri özellikler (varsa) elle uygulanacak.
- `SPIKE-MCP-SDK-2026-001` sonucuna göre bu ADR revize edilebilir.

**Kanıt:** `CT-MCP-STDOUT-001`, `CT-MCP-TOOLLIST-001`, Inspector smoke, gerçek client uyumluluk testi.

## İlgili

- [`../contracts/mcp.md`](../contracts/mcp.md)
- [`../delivery/spikes/SPIKE-MCP-SDK-2026-001.md`](../delivery/spikes/SPIKE-MCP-SDK-2026-001.md)
- KPI-10
