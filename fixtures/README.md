# Fixtures

Deterministik test verileri. Fixture dünyaları **küçük, deterministik ve dağıtılabilir** olmalıdır.

```text
manifests/   Fixture manifest'leri (checksum, bölgeler, izin verilen materyaller)
configs/     Determinism profilleri
worlds/      Dünya verileri
projects/    Örnek Gradle Paper projeleri (build testleri için)
plugins/     Test dependency ve düşmanca (hostile) fixture plugin'leri
```

## Mevcut

| Dosya | İçerik |
|---|---|
| [`manifests/flat-world-v1.yaml`](manifests/flat-world-v1.yaml) | Fixture manifest'i — `source_sha256` dünya verisi üretildiğinde doldurulur |
| [`configs/deterministic-default-v1.yaml`](configs/deterministic-default-v1.yaml) | Determinism profili |

## Gerçek Proje Fixture'ları (M3 — Three Real Project Validation)

| Yol | Amaç | Komutlar | İzinler |
|---|---|---|---|
| `projects/minimal-paper-plugin/` | Minimal tek komutlu plugin | `ping` | `minimalplugin.ping` |
| `projects/medium-plugin/` | Event + scheduled task + çoklu komut | `greet`, `status` | `mediumplugin.status`, `mediumplugin.greet.broadcast` |
| `projects/complex-plugin/` | Config + inventory + izin etkileşimi | `kills`, `tracker`, `welcomeset` | `complexplugin.admin` |

**Proje seçim kriterleri:**
- Gerçek Paper plugin projesi (sentez fixture değil)
- Geçerli `plugin.yml` metadata
- Pinned Paper sürümüyle uyumlu (`26.2 build 84`)
- Gradle Wrapper ile derlenebilir
- Tam E2E pipeline'ı tamamlayabilir: `project_inspect → source snapshot → plugin_build → operation_get → plugin_launch → ready gate → scenario_run → evidence_get → plugin_stop → runtime_release → GC validation`

## Henüz üretilmemiş

| Yol | Amaç | Milestone |
|---|---|---|
| `worlds/flat-world-v1/` | Fixture dünya verisi | M2A |

`plugins/hostile-probe/` — **üretildi** (SPIKE-SAME-JVM-THREAT-001 canlı deneyi,
bkz. `docs/delivery/spikes/SPIKE-SAME-JVM-THREAT-001.md`): bilinçli olarak kötü
niyetli davranışları **dener** — token arama (env/property/dosya/reflection),
endpoint yetkisiz istek, evidence değiştirme, sahte event enjeksiyonu, main thread
bloklama. Bu bir güvenlik açığı değil, limitation'ın hâlâ doğru belgelendiğini
doğrulayan bir ölçüm aracıdır (`ST-SAMEJVM-001`, `ST-SAMEJVM-002`). Üretim
ortamında YALNIZCA Container backend içinde çalıştırılır; ölçüm driver'ı
`apps/run-supervisor/src/spike-hostile-probe.ts` (canlı Paper + EULA kabulü gerekir,
normal CI'da koşmaz).

## Kurallar

- Fixture içeriği manifest checksum'ı ile eşleşmelidir; eşleşmezse `FIXTURE_CHECKSUM_INVALID`.
- `regions` ve `allowed_materials` yalnızca dokümantasyon değildir: `world.set_block` bunlara kısıtlanır.
- Runtime dosyaları buraya **yazılmaz**; fixture salt okunur kabul edilir ve her runtime'a kopyalanır.
