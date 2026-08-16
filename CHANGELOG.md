# Changelog

Kanal: `prototype` · Tek durum kaynağı: [`status/project-status.yaml`](status/project-status.yaml).

Henüz sürümlenmiş bir paket dağıtılmadığı için sürüm numarası yerine milestone
bazında değişiklikler listelenir. İlk sürümlü paket (ör. `0.1.0`) üretildiğinde
bu dosya karşılık gelen sürüm başlığına taşınır.

## 0.1.0-prototype — 2026-08-16

### Eklendi

- **MCP yüzeyi** — resmî `@modelcontextprotocol/*` 2.0.0 SDK'sı (ADR-0010), stdio,
  conformance 57/57, protokol `2026-07-28`; MCP Resources canlı (9 URI şablonu,
  ResourceFacade + SDK kaydı).
- **Scenario DSL + assertion motoru (M2A)** — disposable runtime per scenario,
  determinism profili, expected/actual/attempts/duration görünürlüğü, eventual
  waits (`within`), config error scenario'ları (DSL-12 `expect`), JSON/Markdown/
  JUnit XML raporlar (tek `report_id`), evidence provenance zinciri (11 kanıt).
- **Protocol Test Actor (M2B)** — actor lifecycle, blok kırma, native permission,
  chat/komut yakalama; 100 actor senaryosu; crash sonrası cleanup (DSL-10).
- **V1.1 yatay yetenekler** — event subscription, runtime pool, ikinci Paper
  profili, performance profiler, geçici izin (`runtime_discard`), copy-on-write
  fixture, actor inventory, capability registry (51 capability / 113 error / 3 profil).
- **Güvenlik katmanı (M3)** — process/container/injection/recovery testleri,
  malicious container testleri (hermetic her platformda + canlı Docker probe),
  dependency-scan (OSV), SBOM (>=50 component), checksum üretimi, secret scan,
  doctor (10 health check), üç gerçek proje doğrulaması.
- **CI matrix** — typescript + security [ubuntu, windows], paper-smoke (gerçek
  Paper 5 lifecycle), e2e-minimal (official MCP Client zinciri), SBOM, checksum,
  doctor, secrets, dependency-scan — 13 job.
- **CLI** — `mcpdev install`/`uninstall`/`doctor`/`eula accept`/`serve`.

### Değişti

- EULA kabulü ajan parametresinden operatör yüzeyine taşındı (separation of
  authority): yalnızca `mcpdev eula accept`.
- Agent yüzeyi raw host path almaz (root_path sızıntısı kapatıldı).
- `install` artık `--frozen-lockfile` hard fail kullanır; bozuk lockfile
  `LOCKFILE_OUT_OF_DATE` döner.
- Scenario engine cleanup'ı her terminal durumda koşar (given/when/engine hatası
  dahil); cleanup adımı ana status'ü gizlemez (DSL-10, KPI-12).

### Düzeltildi

- CI flaky test: event-subscription filter testlerinde cursor'u yok sayan mock
  yerine cursor-aware fetcher (tekrar poll'da event çiftlenmesi).
- fixture `gradlew` executable biti (100644 → 100755).
- scenario_run IPC timeout'u (30s → 300s, runtime boot + assertion aşıyordu).

## Önceki aşamalar

M0–M1 (build/runtime/evidence zinciri, reproducible build) ve D0 (architectural
freeze) milestone kanıtları `status/project-status.yaml` ve
`docs/delivery/milestone-acceptance.md` içindedir.
