# Teslimat yol haritası

Tahminler D0C sonunda (2026-08-07) spike sonuçlarına ve gerçek ilerlemeye göre
yeniden hesaplanmıştır.

## D0A — Product Freeze

**Tahmin:** 3–5 iş günü · **Çıkış:** Ürün sınırı ve uyumluluk kararı

- [x] V3 sözleşmesini kabul et
- [x] Paper profile'larını repository'ye koy ve **doğrula** — `paper-26.2-build-84/87/90-v1.yaml` (üçü de `verified`, 2026-08-02)
- [x] Java / Node sürüm doğrulaması (Java 25.0.4, Node 24.18.1, pnpm 10.15.0 — profile verified)
- [x] `plugin.yml` resmî, `paper-plugin.yml` experimental kararı (ADR-0005)
- [x] License (MIT)
- [x] Primary MCP client seçimi (custom transport korunacak, SDK'ya geçiş 2026-07-28 revizyon desteği eklenince — SPIKE-MCP-SDK-2026-001)
- [x] Security claims (ADR-0007)
- [x] M2A/M2B ayrımı (ADR-0006)

## D0B — Feasibility Spikes

**Tahmin:** 7–12 iş günü · **Çıkış:** En riskli teknik bilinmezler · **Durum:** ✅ tamamlandı (2026-08-07)

| Spike | Konu | Sonuç |
|---|---|---|
| [`SPIKE-EXECUTION-CONTAINER-001`](spikes/SPIKE-EXECUTION-CONTAINER-001.md) | Container backend uygulanabilirliği | **closed** — tüm kontroller WSL2'de doğrulandı; copy-in build + tar seed + swap-off + seed fazı + timeout `rm -f` ürüne işlendi |
| [`SPIKE-WINDOWS-PROCESS-001`](spikes/SPIKE-WINDOWS-PROCESS-001.md) | Windows Job Object ile process tree cleanup | **closed** — native addon gerekmez; `taskkill /T /F` yeterli (0 orphan); Windows Trusted Local M1'de destekli |
| [`SPIKE-ACTOR-001`](spikes/SPIKE-ACTOR-001.md) | Protocol test actor | **closed** — ADR-0006 ile uyumlu; M2B koşullu milestone |
| [`SPIKE-MCP-SDK-2026-001`](spikes/SPIKE-MCP-SDK-2026-001.md) | MCP 2026 SDK / protokol durumu | **closed** — stable 2.0.0 mevcut fakat en yüksek `2025-11-25`; kendi transport korunur; SDK geçişi gecikme, engel değil |
| [`SPIKE-PAPER-DOWNLOAD-001`](spikes/SPIKE-PAPER-DOWNLOAD-001.md) | Paper Downloads Service + checksum | **closed** — üç profil de canlı kaynaktan doğrulandı (`verified`) |
| [`SPIKE-SAME-JVM-THREAT-001`](spikes/SPIKE-SAME-JVM-THREAT-001.md) | Same-JVM tehdit sınırı | **closed** — limitation kabul edildi; T2 yalnızca Container backend |

## D0C — Architecture Freeze

**Tahmin:** 2–3 iş günü · **Durum:** ✅ tamamlandı (2026-08-07) · **Karar: GO**

- [x] Spike sonuçlarını ADR'a bağla (tümü closed; CONTAINER→ADR-0004, ACTOR→ADR-0006, MCP-SDK→ADR-0002, SAME-JVM→ADR-0007)
- [x] Tool profile'larını kilitle (`paper-26.2-build-84/87/90-v1`, `verified` — D0C itibarıyla donmuştur)
- [x] Capability registry formatını kilitle (49 capability, 109 error kodu, 10 şema, 7 generated dosya — D0C itibarıyla donmuştur)
- [x] State machine'leri kilitle (`docs/architecture/state-machines.md` — D0C itibarıyla donmuştur)
- [x] Roadmap yeniden tahmini (aşağıda)
- [x] Go/no-go → **GO** (notlar: SDK geçişi gecikme — V1 gate açık kalır; Container ve Trusted Local her ikisi de doğrulandı; M1 kalan işleri M0 ile karşılaştırılabilir risktedir)

## M0 — Stable Observation

**Tahmin:** 10–15 iş günü · **Durum:** ✅ tamamlandı (2026-08-04)

Monorepo · contracts · MCP stdio · Supervisor IPC skeleton · Paper Bridge lifecycle · loopback auth · capability manifest · server/plugin/world/event read · stable tool facade · evidence skeleton · Inspector · stdout purity · real Paper smoke.

**Kapanış kanıtı:** gerçek Paper 26.2 build 84 üzerinde 5/5 lifecycle (graceful stop, port serbest, handshake silindi, 0 orphan); IPC uçtan uca koşu; MCP istemcisinden 13 araç; `world.set_block` sınır kodları (TOOL_INPUT_INVALID / CAPABILITY_UNAVAILABLE / CHUNK_NOT_LOADED) dört katmanı geçerek korundu.

**Demo:**

> AI istemcisi çalışan disposable Paper runtime'ın sürümünü, plugin'lerini, dünyalarını ve event'lerini okur; hiçbir mutation aracı developer profile'da görünmez.

## M1 — Reproducible Build and Launch

**Tahmin:** 18–28 iş günü · **Durum:** ✅ tamamlandı

Trust store · source snapshot · wrapper verification · dependency locking/verification · Trusted Local · Container backend · build · artifact provenance · runtime image · Paper ready gate · process ownership · recovery · `plugin_build`, `plugin_launch`, `plugin_stop`, `plugin_diagnose`.

**Tamamlananlar** (BOOTSTRAP-STATUS M1 bölümü):

- Trust store ve proje kaydı (FS-01/02, symlink/junction, path traversal)
- Source snapshot (deterministik manifest, SOURCE_CHANGED_DURING_BUILD, DIRTY_WORKSPACE_REJECTED)
- Gradle supply-chain doğrulaması (wrapper/distribution/lock/verification/dynamic-changing)
- Trusted Local backend + build yürütme (shell yok, env allowlist, gradlew-script yerine doğrulanmış wrapper JAR ana sınıfı)
- Build executor + provenance zinciri (dogfood: kendi Bridge'imiz iki modda da aynı artifact SHA-256)
- Container execution backend — **canlı deneyle doğrulandı** (SPIKE-EXECUTION-CONTAINER-001, closed): copy-in build, tar cache seed, swap-off sert bellek limiti, seed fazı, timeout `rm -f`
- Sınırlı ZIP okuyucu, plugin.yml doğrulaması, build kanıtları (3 ayrı kanıt: log/diagnostics/artifact-manifest)

**M1 kalanı (tahmin: 3–7 iş günü):** — ✅ tüm maddeler tamamlandı

- [x] Runtime registry kalıcılığı ve Garbage Collector — `RETENTION → DELETE_VALIDATION → DELETING → DELETED` state machine (`runtime-gc.ts`, `persistent-registry.ts`; 20 yeni test; was-running → CRASHED restore, token asla diske yazılmaz, FS-05 marker kapısı, runtimeRootDir containment)
- [x] `plugin_build` tool'unun IPC'ye `backend` parametresiyle bağlanması (trusted-local varsayılan; container Docker yoksa BACKEND_UNAVAILABLE)
- [x] Container backend'in tool zincirine bağlanması (service wiring: lazily oluşturulan ContainerExecutionBackend, getAvailability kapısı, BuildExecutor'a delege)
- [x] Build edilen plugin'in disposable runtime'da başlatılması + M1 demosu — canlı koşumlar: trusted-local 13.7 s build, container ile **birebir aynı artifact sha256** (`4a82aae89b...`), her iki backend'de MinimalPlugin enabled=true, graceful stop, GC 0 kalıntı. Kılavuz: [`../operations/m1-demo.md`](../operations/m1-demo.md)
- [x] Trusted Local için Windows kanıtıyla `plugin_diagnose` (taskkill /T cleanup) — Windows 11'de trusted-local koşumunda diagnose OK + graceful stop + GC taraması 0 kalıntı; force-kill kanıtı SPIKE-WINDOWS-PROCESS-001 (closed, 0 orphan)

**Demo:**

> Kayıtlı kaynağı snapshot al, build et, artifact'i disposable Paper runtime'da başlat, plugin enabled kanıtı üret ve temiz kapat. ✅ her iki backend'de koşuldu.

## M2A — Server-side Deterministic Scenarios

**Tahmin:** 12–18 iş günü → **10–15** (runtime hazırlığı, ready gate ve evidence altyapısı M1'de olgunlaşıyor; determinism profile + Scenario DSL + assertion motoru yeni iş olarak kalıyor)

Fixture manifest · determinism profile · disposable runtime per scenario · Scenario DSL · server/plugin/log/event/block assertion'ları · config error scenario · JSON/Markdown/JUnit · evidence provenance.

> **Durum (M2A tamamlandı — 2026-08-09):** Scenario DSL + assertion motoru gerçek Paper'da koşuyor: 6 scenario, 8/8 assertion pasif + 3/3 config error scenario beklenen hata koduyla (DSL-12 `expect`), GC kalıntısız (`docs/operations/m2a-demo.md`). Rapor formatları (JSON/Markdown/JUnit XML, tek `report_id` + provenance) `scenario-report.ts` ile üretiliyor; evidence provenance zinciri canlı doğrulandı (11 kanıt, content-addressed store, manifest `serverInstanceId`/`bridgeBootId` taşır); `scenario_run` tool dönüşü assertion düzeyi görünürlük sunar (expected/actual/attempts); EULA akışı separation of authority'a taşındı — kabul yalnızca `mcpdev eula accept` (operator) ile yapılır, araç parametresi kaldırıldı; kabul yoksa `EULA_NOT_ACCEPTED` (error catalog; runtime dizini oluşmaz), kabul varsa gerçek koşu + evidence/assertion görünürlüğü (`docs/operations/mcp-eula-check.md`).

## M2B — Protocol Actor Scenarios

**Tahmin:** 12–25 iş günü · **Koşul:** `SPIKE-ACTOR-001` başarılı (✅ closed)

Actor lifecycle · login · command · native permission · block break · message capture · actor evidence.

> M2B koşulu sağlandı: ADR-0006 ile uyumlu tasarım spike'la doğrulandı. Başlangıç zamanlaması M2A çıktısına bağlıdır.

> **Durum (M2B tamamlandı — 2026-08-16):** Actor scenario'ları kapalı — `m2b-actor-scenarios.test.ts` (6 test): fixture doğrulama (`scenarios/actor/*.yaml` + capability registry), tam yaşam döngüsü (create→get_state→look→move→chat→disconnect_all), blok kırma (BlockBreakEvent → block.break), native permission (yetkisiz komut `dispatch_ok=false`), 100 actor lifecycle, actor crash cleanup (ACTOR_CRASHED'da bile cleanup koşar). DSL-10 engine düzeltmesi: cleanup her terminal durumda koşar (`#runCleanup`); cleanup adımı ana status'ü gizlemez. Live Paper koşumu `docs/operations/m2b-demo.md` (`runM2ADemo` + `scenarioFiles`). Kapanış kanıtları: `docs/delivery/milestone-acceptance.md` (7/7).

## M3 — Security Hardening and Beta

**Tahmin:** 15–25 iş günü → **12–20** (container kontrolleri ve hostile-probe kanıtları spike'larda üretildi; CI matrix ve üç gerçek proje denemesi ana yük olarak kalıyor)

Full security regression · malicious fixtures · quotas · CI matrix · lifecycle stress · installer · doctor · SBOM · üç gerçek proje · dokümantasyon.

> **Durum (M3 tamamlandı — 2026-08-16):** Security hardening + beta kapıları yeşil. CI matrix 13 job (typescript/security ubuntu+windows, secrets, sbom, checksum, doctor, paper-smoke, e2e-minimal) — son run `31936226316` success. Doctor 10 health check (pin'li sürümler), SBOM ≥50 component gate, dependency-scan (OSV, HIGH+ allowlist kuralı), malicious container testleri (hermetic her platformda + canlı Docker probe), M3-paper-smoke (gerçek Paper 5 lifecycle), M3-e2e-minimal (official MCP Client zinciri). Kanıtlar `status/project-status.yaml` M3 bloğunda.

## V1 — Stable Local Release

**Tahmin:** 5–10 iş günü stabilization

Koşullar: stable MCP 2.x SDK **veya** açık release-blocker çözümü · P0/P1 closed · no destructive agent tools · no orphan · no path escape · no secret leak · üç proje · deterministik scenario'lar · install/uninstall · incident response.

> SDK durumu (SPIKE-MCP-SDK-2026-001): stable 2.0.0 mevcut fakat `2026-07-28` revizyonunu desteklemiyor — kendi transport korunuyor; SDK geçişi gecikme, V1'i bloke eden bir madde değil. `mcp.sdk_prototype.linked: false` kalır; SDK revizyon desteği eklediğinde `true` olur.

> **Durum (V1 tamamlandı — 2026-08-16):** Stable Local Release kapanışı — `release-checklist.md` tüm maddeler `[x]` ve kanıt zinciri yeşil (CI 13/13, run `31936226316`). V1 çıkış koşulları karşılandı: P0/P1 closed, no destructive agent tools, no orphan (0/100), no path escape, no secret leak, deterministik scenario'lar, install/uninstall, incident response, üç gerçek proje. M2B conditional sonucu kesin (SPIKE-ACTOR-001 kısmen başarılı; doğrulanan capability'ler V1'de). Kanal `prototype` — ilk sürümlü pakette changelog + migration notes doldurulacak.

## Nihai uygulama sırası

```text
 1. Product and compatibility freeze
 2. Capability and error schemas
 3. MCP stdio + stable tool facade
 4. Run Supervisor skeleton
 5. Paper Bridge read-only
 6. Trust and source snapshot
 7. Gradle supply-chain validation
 8. Execution backends
 9. Reproducible build
10. Disposable Paper runtime
11. Ready gate and evidence
12. M2A deterministic scenarios
13. M2B actor scenarios if gate passes
14. Security hardening
15. Beta on real projects
16. Stable V1 release
```

> **Sıranın kritik ilkesi:** AI ajanına mutation yetkisi verilmeden önce source provenance, process ownership, disposable runtime, audit, evidence ve cleanup katmanları tamamlanmış olmalıdır.
