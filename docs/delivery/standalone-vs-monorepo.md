# Standalone paket vs monorepo — dağıtım analizi ve registry kararı

Phase 2 kapsamında `mcpdev` dağıtımı iki biçimde servis edilir (Commit 8 fark
raporu):

| | Monorepo (workspace) | Standalone (`mcpdev` npm paketi) |
|---|---|---|
| Kimlik | `minecraft-plugin-dev-mcp` monorepo kökü | `mcpdev` tek npm paketi (bundled `@mcpdev/*`) |
| Kurulum | repo clone + `pnpm install --frozen-lockfile` + `pnpm run build` | `npm install <tarball>` (harici deps registry'den) |
| Derleme | gereklidir (TS + contract gen + bridge Gradle) | pakette gömülü; kullanıcı tarafında derleme yok |
| Bridge JAR | `bridge/paper/build/libs/*.jar` | `dist/content/bridge/mcpdev-bridge.jar` (kurulumda pakette) |
| Compatibility + manifest | `compatibility/`, `fixtures/manifests/` | `dist/content/` taşınır; profil pin'leri normatiftir |
| Kalıcı veri | repo içi (runtime, evidence) | `$MCPDEV_DATA_DIR` veya `~/.mcpdev` — pakete asla yazılmaz |
| Layout tespiti | `detectLayout` 4 seviye yukarı (repo kökü) | `STANDALONE` marker'ı — [ADR-0014](../adr/0014-standalone-distribution.md) |
| Doğrulama | repo `pnpm run check` | tarball SHA-256 (`SHASUMS.sha256`) + CI `standalone` job |
| MCP client bağlama | manuel `mcpdev config <client>` gerekli değildi | `mcpdev config <client>` — claude/vscode/cursor/opencode |
| Süreç yüzeyi | `node apps/cli/dist/src/index.js …` | `mcpdev …` (aynı entry; mutlak `node` + path) |

## CLI çıktı örnekleri (standalone tarball, temiz kurulum)

Kurulum ve sürüm:

```text
$ npm install -g mcpdev-0.1.0-prototype.0.tgz
added 5 packages in 4s
$ mcpdev --version
0.1.0-prototype.0
```

Veri dizinleri hazırlama ve sağlık kontrolü:

```text
$ MCPDEV_DATA_DIR=./demo-data mcpdev install
✔ mcpdev install: çalışma dizinleri hazır
$ MCPDEV_DATA_DIR=./demo-data mcpdev doctor --json
{
  "layout": "standalone",
  "contentRoot": "<paket>/dist/content",
  "checks": [ … ]
}
```

MCP istemcisine bağlama (`opencode` → global `~/.config/opencode/opencode.json`):

```text
$ mcpdev config opencode --json
{
  "client": "opencode",
  "filePath": "…/.config/opencode/opencode.json",
  "action": "created",
  "message": "'mcpdev' server tanımı yazıldı",
  "serverName": "mcpdev"
}
```

Farklı mevcut tanım korunur; üzerine yazmak için `--force`:

```text
$ mcpdev config cursor
✖ mcpdev config cursor: Mevcut 'mcpdev' tanımı farklı — üzerine yazmak için --force kullanın
```

## Registry kararı

- **npm registry (`mcpdev` unscoped):** küresel isimdir; `npm publish` yazma
  yetkisi gerektirir. İsim çakışması veya topluluk ima riski kurulurken
  denetlenir. Yayına hazır: `scripts/publish-standalone.mjs --registry npm`.
- **GitHub Packages (`@<owner>/mcpdev`):** scoped ad, github registry yazma
  yetkisi (NODE_AUTH_TOKEN) gerekir; kopyada adı scoped yaparak kaynağa
  dokunmadan yayınlar: `scripts/publish-standalone.mjs --registry github --scope <owner>`.
- **Prototip için öneri:** önce `--dry-run` ile `--registry npm` denensin (ad
  müsaitse); değilse GitHub Packages'a geçilir. Yayınlanmayan tarball+SHASUMS
  yolu her iki durumda da yedek/denetim kanıtı olarak kalır (ADR-0014).

Yayın kapıları (supply-chain kuralı yayınlama akışına da uygulanır):
tarball SHA-256 `SHASUMS.sha256` ile birebir; dry-run pack'in `node_modules/@mcpdev/*`
bundle'ı içerdiği `tar -t` ile kanıtlanır; `--version` verildiyse kaynak
sürümüyle eşleşmek zorundadır.

## İlgili

- [ADR-0014](../adr/0014-standalone-distribution.md) — karar zemini
- [`../operations/install.md`](../operations/install.md) — standalone kurulum akışı
- [`scripts/publish-standalone.mjs`](../../scripts/publish-standalone.mjs) — yayın aracı
- [`scripts/build-standalone.mjs`](../../scripts/build-standalone.mjs) — assembly + SHASUMS