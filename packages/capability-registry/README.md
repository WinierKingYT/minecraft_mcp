# Capability Registry

Bu paket, ürünün **tek gerçek kaynağıdır**. Aşağıdakiler bu kayıtlardan üretilir:

- MCP tool tanımları ve profil listeleri
- TypeScript tipleri (`packages/generated-types`)
- Java enum/DTO (`bridge/paper` generated source set)
- Scenario DSL step allowlist'i
- Risk matrisi tablosu (`docs/contracts/capability-registry.md`)
- Contract test stub listeleri

```bash
pnpm run gen
```

Drift kontrolü (CI):

```bash
pnpm run gen:check
```

## Dosya düzeni

```text
schema/capability.schema.json   Kayıt şeması
capabilities/<id>.yaml          Her capability için bir dosya
```

Dosya adı capability `id`'sinin noktaları tire ile değiştirilmiş hâli olmalıdır (`world.block.write` → `world-block-write.yaml`); `scripts/validate-registry.mjs` bunu denetler.

## Risk seviyesi türetimi

`risk.level` elle yazılır **ve** generator tarafından metadata'dan yeniden hesaplanıp doğrulanır. Uyuşmazlık CI hatasıdır — bu, seviyeyi elle düşürerek bir capability'yi agent'a açmayı imkânsız kılar.

Sıra önemlidir: kural listesi yukarıdan aşağıya değerlendirilir ve **ilk eşleşen** seviye kazanır (en yüksek seviyeden en alçağa).

| Seviye | Koşul |
|---|---|
| R4 | `effect: delete` **veya** `scope: host \| production` **veya** `reversibility: destructive` |
| R3 | `reversibility: snapshot_recoverable` **veya** (`effect: mutation \| process` ve `scope: project`) |
| R2 | `effect: mutation` ve `scope: fixture \| disposable_runtime` ve `reversibility: runtime_discard` |
| R1 | `effect: build \| process` ve `scope: disposable_runtime` **veya** (`effect: read` ve `scope: project`) |
| R0 | `effect: read` ve `scope: fixture \| disposable_runtime` |

Salt okuma yapan bir capability, kapsamı `project` olsa bile en fazla **R1**'dir. Bir kaynak ağacını okumak ile onu değiştirmek aynı risk sınıfında değildir; aksi hâlde `project_inspect` gibi zararsız bir keşif aracı ADR-0007'nin R3 kısıtına takılırdı.

## Değişmez kurallar

1. R3/R4 capability'lerinde `exposure.developer_tool` **null olmak zorundadır** (ADR-0007).
2. `risk.effect: mutation` olan her capability `limits.requires_idempotency: true` taşımak zorundadır.
3. Aynı tool adı iki capability'de kullanılamaz.
4. `errors` listesindeki her kod error-catalog'da mevcut olmalıdır.
5. Bir profil listesinde geçen her tool adı bir capability kaydına bağlı olmalıdır.
