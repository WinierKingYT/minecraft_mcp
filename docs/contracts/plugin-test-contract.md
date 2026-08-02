# Paper plugin keşfi ve test sözleşmesi

Karar kaydı: [`../adr/0005-plugin-metadata-policy.md`](../adr/0005-plugin-metadata-policy.md)

## `plugin.yml` doğrulaması

Zorunlu kontroller:

- `name`
- `version`
- `main`
- `api-version`
- main class JAR içinde mevcut mu
- dependency listesi
- soft dependency listesi
- load order
- duplicate plugin name
- target Paper API uyumluluğu

Hata kodları:

```text
PLUGIN_METADATA_NOT_FOUND
PLUGIN_METADATA_AMBIGUOUS
PLUGIN_MAIN_CLASS_MISSING
PLUGIN_API_VERSION_MISSING
PLUGIN_API_VERSION_INCOMPATIBLE
PLUGIN_DEPENDENCY_UNSATISFIED
PLUGIN_LOADING_CYCLE
PLUGIN_NAME_CONFLICT
PAPER_PLUGIN_EXPERIMENTAL_DISABLED
```

## Plugin test contract

Proje isteğe bağlı olarak `.mcp-minecraft/test-contract.yaml` sağlar. Sürüm: `plugin_test_contract: 1`.

```yaml
version: 1

plugin:
  id: claim-plugin
  expected_name: ClaimPlugin

commands:
  claim_create:
    executor: player
    command: "claim create"
    permission: "claim.create"
    arguments:
      type: object
      properties:
        corner1:
          $ref: "#/$defs/position"
        corner2:
          $ref: "#/$defs/position"
      required: [corner1, corner2]
    render:
      template: "claim create {corner1.x},{corner1.z} {corner2.x},{corner2.z}"

messages:
  claim_protected:
    matching:
      translation_key: "claim.protected"
      fallback_plain_text:
        - "Bu alan korunuyor"
        - "You cannot break blocks here"

permission_provider:
  type: native-paper

test_dependencies:
  required: []
  optional: []

config_fixtures:
  default:
    source: "src/testFixtures/mcp/default-config"
```

Bu sözleşmenin amacı, scenario yazarının **raw command string** yazmasını gerektirmeden typed command çağrısı yapabilmesidir. `render.template` yalnızca sözleşme sahibi projenin tanımladığı, allowlist'lenmiş bir dönüşümdür; ajan bu şablonu değiştiremez.

## Manifest olmayan plugin

Manifest yoksa **çalışan** testler:

- build
- startup
- plugin enabled
- log assertion'ları
- generic event assertion'ları
- generic world state assertion'ları

Manifest yoksa **açılmayan** testler:

- plugin-specific typed command
- plugin-specific mesaj assertion'ları

Bu durum bir hata değildir; `scenario_validate` eksik capability'yi açık biçimde bildirir.

## Permission provider'lar

| Provider | Durum |
|---|---|
| Native Paper permission attachment | Desteklenir |
| Harici permission sistemi | Adapter gerektirir |
| LuckPerms / Vault | **Otomatik varsayılmaz** |
| Adapter'ı olmayan provider | `PERMISSION_PROVIDER_UNSUPPORTED` |

LuckPerms adapter'ı V1.1 adayıdır.
