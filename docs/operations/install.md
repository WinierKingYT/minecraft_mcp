# Kurulum ve kaldırma (mcpdev)

`mcpdev` CLI'sı proje geliştirme altyapısını kurar/kaldırır. Kurulum **kalıcı sistem
değişikliği yapmaz** — yalnızca proje içi dizinler, bağımlılıklar ve build çıktıları
oluşturur/siler. Kod, config ve lock dosyalarına dokunulmaz.

> Komutlar repo kökünden çalıştırılır. Proje kökü otomatik tespit edilir; farklı bir
> dizinden çalıştırmak için `--root <path>` kullanılır.

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
