# Güven, proje kaydı ve kaynak snapshot

## Proje kaydı

Kullanıcı aracı keyfî path ile çağıramaz. Önce proje kaydedilir:

```yaml
project:
  id: claim-plugin
  canonical_root: "D:/Projects/ClaimPlugin"
  registered_at: "2026-07-29T12:00:00Z"
  registered_by: user
  trust_level: developer-workspace
  allowed_backends:
    - trusted-local
    - container
```

**Karar:** Trust kaydı proje klasörünün **içinde** tutulmaz. Aksi hâlde bir projeye yazma yetkisi olan kod kendi trust seviyesini yükseltebilirdi.

## Kayıt yüzeyleri ve kalıcılık (P0-4k)

Tek kayıt yüzeyi **launcher config/CLI**'dir: Supervisor `--project-id/--project-root` ile başlatılır (P0-7 `serve`). `project_register` capability'si R3'tür (mutation + project scope) ve ADR-0007 gereği hiçbir profilde agent yüzeyine çıkmaz — agent kendi trust kaydını yazamaz; yüksek trust seviyeleri (`approved-fixture`, config uzantısıyla `pinned-source`) yalnızca insan tarafından girilir.

**Kalıcılık:** Supervisor `--registry-file <path>` ile başlatıldığında kayıtlar JSON dosyasına yazılır (versiyonlu, atomic write: temp + rename) ve restart'ta geri yüklenir. Geri yüklenemeyen kayıtlar (kök silinmiş, symlink'e dönmüş, bozuk backend config) tek tek atlanır ve loglanır; tek bozuk kayıt registry'yi çökertmez. Flag verilmezse registry bellek içidir (mevcut davranış). Önerilen konum: `<repoRoot>/.mcpdev-data/project-registry.json` (gitignore'lu).

**Silme:** `project.unregister` IPC yüzeyi **yoktur** (delete araçlarının agent yüzeyine çıkmaması kuralı). Kayıt kaldırma launcher/config tarafındadır.

## Trust seviyeleri

| Seviye | Açıklama | Build | Container zorunlu |
|---|---|---|---|
| `untrusted` | Build çalıştırılamaz | ✗ | — |
| `developer-workspace` | Kullanıcı kayıtlı workspace | ✓ | Önerilir |
| `pinned-source` | Commit/diff fingerprint ile sabitlenmiş kaynak; CI için | ✓ | Önerilir |
| `approved-fixture` | Ürün repository'sindeki doğrulanmış test fixture | ✓ | Hayır |
| `revoked` | Hiçbir operation çalışmaz | ✗ | — |

## Source snapshot

```json
{
  "source_snapshot_id": "src_01J...",
  "project_id": "claim-plugin",
  "canonical_root_fingerprint": "sha256:...",
  "git": {
    "available": true,
    "commit": "abc123...",
    "branch": "feature/test",
    "dirty": true,
    "dirty_diff_sha256": "sha256:..."
  },
  "input_manifest_sha256": "sha256:...",
  "excluded_paths": [".git", ".gradle", "build", ".idea", ".vscode"],
  "created_at": "2026-07-29T12:00:00Z"
}
```

## Snapshot kuralları

| # | Kural |
|---|---|
| SN-01 | Build aynı `source_snapshot_id` üzerinden çalışır |
| SN-02 | Build sırasında source workspace değişirse `SOURCE_CHANGED_DURING_BUILD` üretilir |
| SN-03 | Snapshot manifest'i relative path, size, mode ve checksum içerir |
| SN-04 | Symlink **default olarak reddedilir** |
| SN-05 | Container backend snapshot'ı **read-only** mount eder |
| SN-06 | Dirty workspace CI profilinde reddedilir |
| SN-07 | Snapshot'tan artifact'e provenance zinciri **zorunludur** |

SN-02 ihlali sessizce tolere edilemez: aksi hâlde rapor, gerçekte derlenmeyen bir kaynak durumuna atıfta bulunur ve KPI-09 anlamsızlaşır.
