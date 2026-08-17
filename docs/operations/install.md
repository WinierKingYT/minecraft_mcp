# Kurulum ve kaldırma (mcpdev)

`mcpdev` CLI'sı proje geliştirme altyapısını kurar/kaldırır. Kurulum **kalıcı sistem
değişikliği yapmaz** — yalnızca proje içi dizinler, bağımlılıklar ve build çıktıları
oluşturur/siler. Kod, config ve lock dosyalarına dokunulmaz.

İki kullanım akışı vardır:

1. **Standalone (npm paketi)** — kullanıcı akışı: tek tarball ile
   `mcpdev` komutu kurulur (bkz. [ADR-0014](../adr/0014-standalone-distribution.md)).
   Repo clone'u, pnpm veya build gerekmez; yalnızca Node.js ve Java gereklidir.
2. **Workspace (repo) geliştirici akışı** — repo kökünden `node apps/cli/...`
   ile çalıştırılır ve projeyi derler.

## Standalone kurulum (npm paketi)

```text
npm install -g <tarball>   # global; veya kendi projesine: npm install <tarball>
```

Paket `mcpdev` binary'sini sağlar; self-location her iki dizinde de çalışır ve
veri kökünü `$MCPDEV_DATA_DIR` veya `~/.mcpdev` olarak seçer:

```text
mcpdev install      # veri dizinlerini hazırlar (config, paper-cache, artifacts, evidence)
mcpdev doctor       # sağlık kontrolü (layout: standalone)
mcpdev eula accept  # Minecraft EULA kabulü (operatör kararı)
mcpdev serve        # MCP Server + Supervisor (stdio)
mcpdev config <client>  # istemci config'ine mcpdev tanımını yazar (bkz. alt bölüm)
mcpdev uninstall    # yalnızca veri dizinlerini kaldırır
```

Gereksinim: Node.js >= 22 ve Java (profildeki major). İlk `serve` öncesi
`mcpdev install` ile veri kökü hazırlanır; `doctor` eksikleri raporlar.

### MCP istemcilerine bağlama: `mcpdev config <client>`

| client | Hedef dosya | Şekil |
|---|---|---|
| `claude` | Claude Desktop (`claude_desktop_config.json`) | `mcpServers.mcpdev` `{command, args:[…,"serve"]}` |
| `vscode` | `.vscode/mcp.json` (workspace) | `servers.mcpdev` `{type:"stdio", …}` |
| `cursor` | `~/.cursor/mcp.json` | `mcpServers.mcpdev` `{command, args:[…,"serve"]}` |
| `opencode` | `~/.config/opencode/opencode.json` | `mcp.mcpdev` `{type:"local", …}` |

Komut mutlak `node` + derlenmiş giriş noktası kullanır; PATH varsayımı yoktur.
Aynı `mcpdev` anahtarı zaten farklı bir tanım içeriyorsa komut **üzerine
yazmaz** — `--force` ister (mevcut config'i bozma). `--json` makine-okunur
rapor verir (`action`: `created`/`updated`/`identical`/`conflict`).

```text
mcpdev config opencode --json
mcpdev config vscode --root <workspace> --force
```

> Komutlar repo kökünden çalıştırılır. Proje kökü otomatik tespit edilir; farklı bir
> dizinden çalıştırmak için `--root <path>` kullanılır.

## Workspace (repo) geliştirici akışı

Aşağıdaki adımlar repo geliştiricisi içindir; standalone kullanıcılar bu
bölümü atlar.

## Ön koşullar

`mcpdev install` aşağıdaki araçların varlığını doğrular ve eksikse hata verir:

| Araç | Sürüm | Kontrol |
|---|---|---|
| Node.js | >= 22 (pin: 24.18.1) | `node --version` |
| Java | 25 (toolchain major) | `java -version` |
| pnpm | 10.x (packageManager) | `pnpm --version` |

## Kurulum

```text
node apps/cli/dist/src/index.js install
```

`install` sırayla:

1. Proje kökünü doğrular (`package.json` arar)
2. Gerekli dizinleri oluşturur (`compatibility/`, `fixtures/worlds`, `fixtures/projects`,
   `fixtures/plugins`, `fixtures/malicious/...`) — varsa atlar
3. Node sürümünü doğrular (>= 22)
4. Java varlığını doğrular
5. `pnpm install --frozen-lockfile` koşar — **fallback yoktur**; lockfile bozuksa
   `LOCKFILE_OUT_OF_DATE` hatası döner (lockfile'ı güncelleyip commit etmek gerekir)
6. `pnpm run build` ile projeyi derler
7. Contract dosyalarını üretir (`scripts/generate-contracts.mjs`)

Adım çıktıları `✔ done` / `- skip` / `✖ fail` ikonlarıyla gösterilir. Herhangi bir adım
fail olursa `install` exit 1 döner ve sorunları giderip tekrar çalıştırmayı önerir.

Kurulumu doğrulamak için:

```text
node apps/cli/dist/src/index.js doctor
```

## Kaldırma

```text
node apps/cli/dist/src/index.js uninstall
```

`uninstall` şunları siler (varsa, yoksa `skip`):

- `node_modules/`
- Build çıktıları: `apps/mcp-server/dist`, `apps/run-supervisor/dist`, `apps/cli/dist`,
  `packages/*/dist`, `bridge/paper/build`
- Üretilmiş dosyalar: `packages/error-catalog/generated/errors.json`,
  `packages/contracts/generated/*.json`
- `sbom.json` (kök)

**Silmeyeceği şeyler:** kaynak kod, config dosyaları, lock dosyaları, `compatibility/`,
`fixtures/`, `status/`, `docs/`.

`--json` bayrağı makine-okunur çıktı üretir (step bazında `bytesRemoved` dahil):

```text
node apps/cli/dist/src/index.js uninstall --json
```

Kaldırma sonrası tekrar kurulum için `install` çalıştırılır.

## Tipik akış

```text
node apps/cli/dist/src/index.js install      # kur
node apps/cli/dist/src/index.js doctor       # doğrula
node apps/cli/dist/src/index.js eula accept  # EULA kabulü (operatör)
node apps/cli/dist/src/index.js serve        # MCP Server + Supervisor (stdio)
```

## Bağımlılıklar

- `apps/cli/src/install.ts` — kurulum adımları (frozen-lockfile hard fail)
- `apps/cli/src/uninstall.ts` — kaldırma adımları
- Testler: `apps/cli/test/uninstall.test.ts`, `apps/cli/test/doctor.test.ts`
