# ADR-0014 — Tek npm paketi (standalone) dağıtımı ve layout self-location

**Durum:** accepted
**Tarih:** 2026-08-18
**Bağlam:** [`../delivery/roadmap.md`](../delivery/roadmap.md) Phase 2 — standalone dağıtım

## Bağlam

V1.0 release notu (`.github/workflows/release.yml`), monorepo `@mcpdev/*`
workspace paketlerinin npm registry'ye yayınlanmadığını ve bu yüzden paket
tarball'larının **`npm install <tarball>` ile kurulamadığını** açıkça
belgelenmişti; kurulum yolu yalnızca repo kökünden `mcpdev install`'dı. Bu,
hedef kullanıcının (bir Minecraft plugin projesi geliştiricisi) akışını
daraltıyordu: repo clone'u + araç takımı kurulumu olmadan MCP client'a
bağlanamıyordu.

Phase 2 üç gereksinimi birleştirdi:

1. **Tek npm paketi** — `npm install <tarball>` (veya gelecekte registry) ile
   kurulabilen `mcpdev`.
2. **Layout self-location** — aynı CLI iki düzende çalışır: repo
   (workspace) ve kurulu paket (standalone); kullanıcı verisi asla pakete
   yazılmaz.
3. **MCP client auto-config** — `mcpdev config <client>` stdio tanımını
   istemci config'ine yazar (P0-7 launcher yüzeyi), mutlak `node` + mutlak
   giriş noktası kullandığı için PATH'e ve çalışma dizinine bağımlılığı yoktur.

## Karar

Standalone dağıtımı `mcpdev` adlı **tek npm paketi**dir; `scripts/build-standalone.mjs`
ile assembly edilir ve `dist-standalone/mcpdev-<sürüm>.tgz` tarball'ı + tarball
`SHA-256` (`mcpdev-<sürüm>.tgz.sha256`, `SHASUMS.sha256`) üretilir.

- **Dahili paketler** (`@mcpdev/contracts`, `@mcpdev/evidence-model`,
  `@mcpdev/generated-types`) paket kökündeki `node_modules/@mcpdev/*` altına
  gömülür, `bundleDependencies` ile tarball'a taşınır. `file:` bağımlılıkları
  **kullanılmaz** (npm 11.x arborist `file:` hedeflerini bundle içinde çözerken
  `isDescendantOf` ile crash verir). Bundled package.json'dan
  `dependencies`/`devDependencies` silinir: npm bundled dep'in bağımlılıklarını
  kurmaz, boş alan registry çözümlemesini de yok eder.
- **Harici runtime bağımlılıkları yalnızca üçtür** ve consumer'da registry'den
  kurulur: `@modelcontextprotocol/server@2.0.0`, `yaml@2.8.1`, `zod@4.4.3`.
  Aksi hâlde tarball içinde registry hedefi olmayan bağımlılık çözümlemesi
  tüm dağıtımı kırardı.
- **Tarball`, npm pack ile değil, sağlam `tar -czf` ile** üretilir: npm pack
  elle yerleştirilen `node_modules`'u bundle etmez; `package` sanal kökü npm
  tarball konvansiyonunu karşıladığından consumer'da `npm install <tgz>`
  sorunsuzdur.
- **Layout self-location** (`apps/cli/src/layout.ts`): standalone paket kökündeki
  `STANDALONE` marker'ı ile tanınır; workspace düzeni entry'nin 4 seviye
  yukarısındaki repo kökünü kullanır. Content (compatibility profilleri,
  fixture manifest, bridge JAR) her iki düzende `dist/content` altındadır;
  supervisor aynı `--repo-root` yüzeyiyle çalışır. Kullanıcı verisi (EULA,
  registry, evidence, paper-cache, artifacts) daima `$MCPDEV_DATA_DIR` veya
  `~/.mcpdev` altına yazılır — paket salt-okunur yeniden dağıtılabilir olsun
  diye pakete asla yazılmaz.
- **MCP client auto-config** (`mcpdev config <client>`): claude/cursor → ortak
  `{command,args}` şekli (`mcpServers.*`), vscode → workspace `.vscode/mcp.json`
  (`servers.*`, `type: stdio`), opencode → global
  `~/.config/opencode/opencode.json` (`mcp.*`, `type: local`, komut dizisi).
  Komut mutlak `process.execPath` + mutlak derlenmiş giriş noktası + `serve`;
  farklı mevcut tanım varsa `--force` istenir (sessiz üzerine yazma yok).

## Alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| `npm pack` ile tarball | Elle yerleştirilen `node_modules` bundle edilmez; tarball kurulamaz hâle gelir (Commit 5'te ölçüldü). |
| `@mcpdev/*` paketlerini registry'ye yayınlamak | Sürüm pinini tek yerde tutmak ve yayınlama yükünü (Token, secret yönetimi) ertelemek istendi; seçenek Commit 8'de "publish kararı" olarak ayrı değerlendirilir. |
| Standalone mod olmadan yalnızca `global bin` (`npm i -g`) ile mutlak path yazmak | `npm i -g` binary'sinin gerçek yolu tespit edilse bile content kökü ve birleşik paket güvencesi (kendi kalbimiz: tek gömülü bridge/JAR) kaybolur; ayrıca tarball'ı tüketici kendi projesine yerel kurabilmelidir. |
| Dahili paketleri ayrı çözümlenebilir registry paking yerine `workspace:*` protokolü | Consumer ortamında `workspace:` çözümlenmez; tarball dağıtımının bütünlüğünü bozar. |

## Sonuçlar

**Olumlu**

- Tek tarball; `npm install <tgz>` ile temiz kurulum (Commit 5 canlı doğrulama,
  CI `standalone` job'ı bunu her push'ta tekrarlar).
- Self-location sayesinde aynı CLI üç yüzeyde çalışır: repo geliştirici akışı,
  kurulu paket consumer akışı, MCP client `serve` akışı.
- Tarball SHA-256 hem yan dosyada hem `SHASUMS.sha256`'de; consume öncesi
  bütünlük sağlanabilir.
- `mcpdev config <client>` mutlak komut kullandığı için istemci tarafında
  PATH/çalışma dizini varsayımı yoktur; `--json` makine-okunur rapor verir.

**Olumsuz**

- Tarball boyutu node_modules gömülü olduğundan büyür (ölçüm: ~600 kB, 541 dosya).
- Bundled `@mcpdev` paketlerinin `dependencies` alanı boşaltıldığından, paket
  dışı (ör. contract şemalarını okuyan) bağımlılık eklenirse assembly kuralı
  güncellenmek zorundadır.
- Tarball üretimi `tar` aracına bağımlıdır (Windows'ta bsdtar mevcuttur); ayrı
  `sunzi`/archiver alternatifi gerekirse assembly adımı genişletilir.

**Kanıt:** `scripts/build-standalone.mjs` derleme + checksum çıktısı; `apps/cli`
`layout.test.ts`/`config.test.ts`; PR CI `standalone` job'ı (temiz kurulum →
install → doctor layout standalone → config opencode); `pnpm run check` yeşil.

## İlgili

- [ADR-0002](0002-mcp-stdio-transport.md), [ADR-0008](0008-stateless-protocol-and-stable-sdk.md),
  [ADR-0010](0010-mcp-sdk-2-adoption.md) — SDK yüzeyi: standalone paket aynı
  stable SDK üzerinden `serve`.
- [`apps/cli/src/layout.ts`](../../apps/cli/src/layout.ts) — self-location.
- [`scripts/build-standalone.mjs`](../../scripts/build-standalone.mjs) — assembly + checksums.
- [`../operations/install.md`](../operations/install.md) — standalone kurulum akışı.
- [ADR-0013](0013-wrapper-execution-trust-model.md) — not: tarball'daki
  güven modeli (supervisor-only) değişmez.