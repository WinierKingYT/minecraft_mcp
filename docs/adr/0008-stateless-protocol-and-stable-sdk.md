# ADR-0008 — Stateless protokol yüzeyi ve stable SDK durumu

**Durum:** accepted
**Tarih:** 2026-07-30
**Supersedes:** [ADR-0002](0002-mcp-stdio-transport.md) — yalnızca (b) SDK bağımlılığı kararı ve protokol yüzeyi varsayımları
**Bağlam:** [`../delivery/spikes/SPIKE-MCP-SDK-2026-001.md`](../delivery/spikes/SPIKE-MCP-SDK-2026-001.md)

## Bağlam

ADR-0002 iki varsayım altında yazılmıştı:

1. Protokol revizyonu `2026-07-28` doğrulanmamıştı; release candidate olabileceği düşünülüyordu.
2. Yalnızca alpha SDK (`2.0.0-alpha.2`) mevcut sanılıyordu ve V1 release'i "stable 2.x SDK çıkana kadar" bloklanmıştı.

Uyumluluk doğrulaması (2026-07-30) her iki varsayımı da çürüttü:

| Bulgu | Sonuç |
|---|---|
| `2026-07-28` revizyonu **28 Temmuz 2026'da final** yayınlandı | RC değil; spec kararlı |
| `@modelcontextprotocol/server@2.0.0` **stable** yayınlandı (2026-07-27) | Release blocker'ın gerekçesi ortadan kalktı |
| `@modelcontextprotocol/node@2.0.0` **stable** yayınlandı | Aynı |
| Revizyon `initialize` / `notifications/initialized` el sıkışmasını **kaldırdı** | ADR-0002 döneminde yazılan protokol yüzeyi **yanlıştı** |
| `Mcp-Session-Id` kaldırıldı; çekirdek **stateless** | Oturum durumu tutan her tasarım geçersiz |

Son iki satır kritiktir: bootstrap sırasında yazılan `McpServer`, kaldırılmış bir el sıkışmayı uyguluyordu. Bu, "spec doğrulanmadan implementasyon yazmanın" doğrudan maliyetidir.

## Karar

### 1. Protokol yüzeyi stateless'a taşındı

| Öğe | Karar |
|---|---|
| `initialize` / `notifications/initialized` | **Kaldırıldı.** Çağrılırsa `-32601` ve nedenini açıklayan mesaj döner |
| Oturum durumu | **Tutulmaz.** Sunucuda `initialized` bayrağı yoktur |
| İstemci bağlamı | Her istekte `params._meta` (protokol sürümü, istemci kimliği/capability'leri) |
| Capability keşfi | **Opsiyonel** `server/discover` RPC'si |
| `tools/list` | `ttlMs` + `cacheScope: "server"` taşır |
| Protokol sürümü uyuşmazlığı | Reddedilmez, **loglanır** (spec toleranslı sunucu bekler) |

Kaldırılmış metotlar sessizce kabul edilmez: bunu yapmak, eski bir istemcinin stateful davrandığını sanmasına ve teşhisi zor hatalara yol açardı.

### 2. `resultType` alanı MRTR'nin parçasıdır

Multi Round-Trip Requests, sunucunun `resultType: "input_required"` döndürüp istemcinin `inputResponses` ile yeniden denemesini sağlar. V1 tool'ları yalnızca `resultType: "complete"` üretir; MRTR kullanan bir tool V1'de yoktur. Alan bilinçli olarak yüzeyde tutulur ki ileride ek bir kırıcı değişiklik gerekmesin.

### 3. SDK release blocker'ı kaldırıldı, SDK bağımlılığı henüz kurulmadı

`mcp.sdk.linked: false` olarak kalır. V1 release'i artık **SDK'nın varlığına değil**, şunlara bağlıdır:

- SDK'nın stdio davranışının stdout purity invariant'ını bozmadığının kanıtlanması,
- tam conformance test koşusu,
- `TransportAdapter`'ın SDK üzerine implementasyonu.

`TransportAdapter` seam'i korunur ve şimdi asıl işini görür: protokol yüzeyi stateless'a taşınırken hiçbir tool handler'ı değişmedi.

## Alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| `initialize`'ı geriye dönük uyumluluk için desteklemeye devam etmek | Spec onu kaldırdı; desteklemek stateful bir yol açık bırakır ve stateless çekirdeğin sağladığı garantileri zayıflatır |
| Kaldırılmış metotları sessizce yok saymak (`null` dönmek) | Eski istemci el sıkışmanın başarılı olduğunu sanar; hata daha sonra ve daha belirsiz bir yerde ortaya çıkar |
| Hemen stable SDK'ya geçmek | stdout purity invariant'ı SDK'nın davranışına bağımlı hâle gelir; önce kanıtlanmalı (SPIKE-MCP-SDK-2026-001 sorusu 3) |
| ADR-0002'yi düzenlemek | ADR'ler kabul edildikten sonra düzenlenmez; karar izi korunmalıdır |
| `server/discover`'ı zorunlu kılmak | Spec opsiyonel tanımlıyor; zorunlu kılmak istemci uyumluluğunu kırar |

## Sonuçlar

**Olumlu**

- Protokol yüzeyi yayınlanmış final spec ile uyumlu.
- V1 release gate'inden bir blocker kalktı.
- `TransportAdapter` seam'inin değeri pratikte kanıtlandı.

**Olumsuz**

- Bootstrap sırasında yazılan `McpServer` ve testleri yeniden yazıldı — doğrulanmamış bir spec varsayımının maliyeti.
- `_meta` tabanlı istemci bağlamı her istekte yeniden okunur; bu, oturum başına bir kez yapılan işi istek başına yapmak demektir.
- Stateless çekirdek, ileride oturum gerektiren bir özellik istenirse extension framework'ü zorunlu kılar.

**Kanıt:** `CT-MCP-PROTOCOL-001`, `CT-MCP-STDOUT-001`, `CT-MCP-TOOLLIST-001` — [`../../apps/mcp-server/test/stdout-purity.test.ts`](../../apps/mcp-server/test/stdout-purity.test.ts)

## Öğrenilen ders

> Uyumluluk profilinin `verification.status` alanı bir formalite değildir. Doğrulanmamış bir protokol revizyonu üzerine yazılan implementasyon yanlış çıktı; doğrulama D0A'yı kapatmadan M0'a geçilseydi bu hata çok daha pahalıya mal olurdu.

## İlgili

- [ADR-0002](0002-mcp-stdio-transport.md)
- [`../contracts/mcp.md`](../contracts/mcp.md)
- [`../../compatibility/paper-26.2-build-84-v1.yaml`](../../compatibility/paper-26.2-build-84-v1.yaml)
