# Migration notes (prototype kanalı)

Bu dosya, prototype kanalındaki arayüz değişikliklerini özetler. İlk sürümlü
pakete geçişte bu notlar `0.1.0` migration bölümüne taşınır.

Henüz sürümlenmiş bir paket bulunmadığı için aşağıdakiler *development-time*
değişiklikleridir; sürümlenmiş bir config veya araç yüzeyinden veri taşıma
zorunluluğu yoktur.

## Config ve yüzey değişiklikleri

| Alan | Önceki durum | Yeni durum | Not |
|---|---|---|---|
| EULA kabulü | ajan parametresi | yalnızca `mcpdev eula accept` (operatör) | ajan parametresi kaldırıldı — separation of authority |
| Host path görünürlüğü | agent `root_path` alabilir | agent yüzeyi raw host path almaz | root_path sızıntısı kapatıldı |
| lockfile davranışı | fallback | `--frozen-lockfile` hard fail | bozuk lockfile `LOCKFILE_OUT_OF_DATE` |
| scenario cleanup | yalnızca normal tamamlanmada | her terminal durumda (given/when/engine hatası dahil) | DSL-10, KPI-12 |
| runtime quota kontrolü | scenario launch sonrası | launch öncesi (disposable runtime garantisi) | DSL-11 |
| scenario_run timeout | 30s sabit | `IPC_LAUNCH_TIMEOUT_MS` (300s) | runtime boot + assertion aşıyordu |

## MCP araç yüzeyi

- `scenario_run` yanıtı artık assertion düzeyi görünürlük taşır
  (expected/actual/attempts).
- `plugin.list` alan adı `id` → `name`/`enabled` (ready gate ile uyum).
- V1.1 mutation tool'ları (`pool_evict`, `pool_reset`) hiçbir profilde yoktur;
  read-only V1.1 tool'ları developer profilindedir.

## Not

- Gerekli migrasyon yok: prototype kanalında veri taşıma sözleşmesi oluşmadı.
- Kanal değişikliği (prototype → stable) yapıldığında bu bölüm sürüm bazlı
  migrasyon adımlarıyla genişletilir.
