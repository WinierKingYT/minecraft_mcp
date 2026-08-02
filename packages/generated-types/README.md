# @mcpdev/generated-types

**Bu paketteki `*.generated.ts` dosyaları elle düzenlenmez.**

Kaynak:

- [`packages/capability-registry/capabilities/`](../capability-registry/capabilities/)
- [`packages/capability-registry/profiles.yaml`](../capability-registry/profiles.yaml)
- [`packages/error-catalog/errors/`](../error-catalog/errors/)

Üretim:

```bash
pnpm run gen
```

Drift kontrolü (CI'da her PR'da koşar):

```bash
pnpm run gen:check
```

`gen:check` mevcut dosyalarla üretilecek içeriği karşılaştırır. Elle yapılan bir düzenleme burada yakalanır ve PR bloklanır.

## Temiz checkout

Generated dosyalar repository'ye commit edilir (drift testi bunu gerektirir). Ancak bu repository henüz **bootstrap** aşamasındadır ve `pnpm install` bir kez bile çalıştırılmadığı için generated dosyalar **henüz üretilmemiştir**. İlk kurulumda:

```bash
pnpm install && pnpm run gen
```

## Üretilen dosyalar

| Dosya | İçerik |
|---|---|
| `capabilities.generated.ts` | `CAPABILITY_IDS`, `CapabilityId`, `CAPABILITIES` |
| `errors.generated.ts` | `ERROR_CODES`, `ErrorCode`, `ERRORS` |
| `tool-profiles.generated.ts` | `TOOL_PROFILES`, `DEFAULT_TOOL_PROFILE` |

Aynı kaynaklardan Java tarafında `bridge/paper/.../generated/BridgeOperation.java` ve `ErrorCode.java` üretilir.
