# Milestone kabul kriterleri

Bu kriterler [`roadmap.md`](roadmap.md) ve [`release-checklist.md`](release-checklist.md) ile çelişemez (DOC-GATE-01).

## D0

- [ ] Uyumluluk profile repository'de **ve doğrulanmış**
- [ ] Sürüm placeholder'ı bulunmuyor
- [ ] Karar placeholder'ı bulunmuyor
- [ ] ExecutionBackend kararı (ADR-0004)
- [ ] Actor go/no-go
- [ ] MCP SDK risk kararı (ADR-0002)
- [ ] Threat model
- [ ] ADR seti

## M0

- [ ] Bridge dış interface'e bind etmez
- [ ] Yanlış token reddedilir
- [ ] Tool list sabit ve deterministik
- [ ] stdout temiz
- [ ] Inspector geçer
- [ ] Real Paper 5 lifecycle
- [ ] Plugin disable sonrası Bridge thread/port kalmaz

## M1

- [ ] Source snapshot'tan artifact'e provenance
- [ ] Wrapper verification
- [ ] Lock/verification strict
- [ ] Container no-network testi
- [ ] Artifact ambiguity güvenli hata
- [ ] Wrong Java güvenli hata
- [ ] Paper ready gate
- [ ] MCP crash sonrası Supervisor recovery
- [ ] Windows/Linux cleanup

## M2A

- [ ] 3 server-side scenario
- [ ] 20 fresh runtime determinism
- [ ] Expected/observed
- [ ] Cleanup ayrı raporlanır
- [ ] Evidence report
- [ ] Scenario cross-contamination yok

## M2B

- [ ] Actor 100 lifecycle
- [ ] Join/quit
- [ ] Command
- [ ] Permission
- [ ] Block interaction
- [ ] Message capture
- [ ] Actor crash cleanup

## M3

- [x] Security regression green (`security` CI job — process, container, injection, recovery, backend-downgrade, lifecycle-stress, three-project, malicious-fixtures)
- [x] P0 yok (366 tests pass, 0 fail, no critical issues)
- [x] Secret leak yok (`process-security.test.ts` — ST-ENV-001..006)
- [x] Path escape yok (`process-security.test.ts` — ST-PATH-001)
- [x] Container host secret erişimi yok (`container-security.test.ts` — ST-CONTAINER-SECRET-001)
- [x] 100 lifecycle orphan `%0` (`lifecycle-stress.test.ts` — ST-LIFECYCLE-001, 0 orphans in 100 cycles)
- [x] Doctor doğru teşhis (`apps/cli/`, `doctor` CI job, 10 health checks — V1.1'de `compatibility_profiles` ve `capability_registry` eklendi)
- [x] Üç gerçek proje (`fixtures/projects/`, `three-project-validation.test.ts` — 39 tests)

## V1.1

V1.1, V1 sınırına dokunmadan yedi yatay yeteneği paketler: event-driven gözlem, runtime yeniden kullanımı, multi-profile diverjans, performans görünürlüğü, geçici izin yönetimi, immutable fixture'lar ve actor envanteri.

- [x] Event subscription: olay filtresi (tip/actor), TTL, buffer limiti, eşzamanlı abonelikler (`event-subscription.test.ts`, `integration-v11.test.ts`)
- [x] Runtime pool: acquire/release/evict/reset, image bazlı yeniden kullanım, reuse-count limiti (`runtime-pool.test.ts`)
- [x] Multi-profile diverjans: `paper-26.2-build-84-v1` (verified, aktif), `-87-v1` ve `-90-v1` (unverified) — üç profil; `checkSecondProfile` doctor check ≥2 verified profil arar; `compatibility-profiles.test.ts` ≥3 profili doğrular
- [x] Performance profiler: timing/derleme metrikleri (`performance-profiler.test.ts`)
- [x] Permission: native Paper + LuckPerms adapter, attach/detach/check/set_op — yalnızca `runtime_discard` (kalıcı izin üretmez) (`permission-adapter.test.ts`)
- [x] Copy-on-write fixture: immutable fixture snapshot'ları (`cow-fixture.test.ts`)
- [x] Actor inventory: actor envanter takibi (`actor-inventory.test.ts`)
- [x] V1.1 tool hatları MCP yüzeyinde: `pool_status`/`pool_list`/`profile_list`/`profile_get`/`permission_check` (developer, R0); `pool_acquire`/`pool_release`/`permission_attach`/`permission_detach`/`permission_set_op` (debug, R2); `pool_evict`/`pool_reset` hiçbir profilde yok (R4, ADR-0007)
- [x] Capability registry: 12 yeni kayıt, `validate-registry.mjs` yeşil (46 capability, 109 error kodu, 3 profil)
- [x] Entegrasyon: pool + event subscription + scenario veri akışı tek akışta (`integration-v11.test.ts` — CT-INT-V11-001)
- [x] E2E smoke: developer profilinde V1.1 getter'ları listede, mutation tool'ları yok; supervisor'sız `SUPERVISOR_UNAVAILABLE` (`v11-e2e.test.ts` — CT-MCP-V11-E2E-001)
- [x] Unit: V1.1 tool davranışı (başarı/input/error yolları) (`v11-tools.test.ts` — CT-MCP-V11-001)

## V1

- [x] Stable SDK policy karşılandı (ADR-0008 — SDK blocker kaldırıldı, `TransportAdapter` korundu)
- [x] Tüm release artifact'leri checksum ve SBOM taşıyor (`scripts/generate-checksums.mjs`, `scripts/generate-sbom.mjs`, `checksum` CI job)
- [x] Install/uninstall mevcut (`apps/cli/` — `mcpdev install`, `mcpdev uninstall`)
- [x] Known limitations açık (`docs/operations/known-limitations.md`)
- [x] Compatibility manifest mevcut (`docs/operations/compatibility-manifest.md`)
- [x] Incident response mevcut (`docs/operations/incident-response.md`)
- [x] Documentation gates geçiyor (`pnpm run check:docs` — 79 files pass)
- [ ] P0/P1 closed

### P0/P1 epic kapanış matrisi

`P0/P1 closed` koşulu, [`epics.md`](epics.md) içindeki tüm P0 ve P1 epic'lerin kapanış kanıtıyla kilitlendiği anlamına gelir. Her epic aşağıdaki zincirle kapanır: `Epic -> Capability -> Test -> Artifact`. Kapalı bir epic, bu matriste en az bir doğrulama testi ve gerekli artifact'i işaretler.

| Epic | Başlık | Öncelik | Kapanış kanıtı | Durum |
|---|---|---|---|---|
| E01 | Product and ADR | P0 | ADR seti (`docs/adr/`), DOC-GATE-06 | ✅ |
| E02 | Compatibility Profile | P0 | `compatibility/*.yaml` verified + `paper-download.test.ts` | ✅ |
| E03 | Capability Registry | P0 | `validate-registry.mjs` (46 capability, 109 error, 3 profil) | ✅ |
| E04 | Shared Contracts | P0 | `@mcpdev/contracts` + generated types | ✅ |
| E05 | MCP Stdio and Tool Facade | P0 | `stdout-purity.test.ts`, `tool-surface.test.ts` (TL-01..05) | ✅ |
| E06 | Supervisor IPC | P0 | `ipc.test.ts` (CT-IPC-001) | ✅ |
| E07 | Paper Bridge Lifecycle | P0 | `paper-download.test.ts`, `runtime-image.test.ts` | ✅ |
| E08 | Read Operations and Events | P0 | `event-subscription.test.ts`, bridge operation enum | ✅ |
| E09 | Trust and Source Snapshot | P0 | `source-snapshot.test.ts` (ST-SNAPSHOT-001) | ✅ |
| E10 | Gradle Supply Chain | P0 | `gradle-validation.test.ts` (ST-GRADLE-001) | ✅ |
| E11 | Execution Backends | P0 | `backend-security.test.ts` (backend downgrade) | ✅ |
| E12 | Build and Artifact Provenance | P0 | `build-pipeline.test.ts` (IT-BUILD-001) | ✅ |
| E13 | Runtime Lifecycle and Recovery | P0 | `ownership.test.ts`, `recovery-security.test.ts`, `lifecycle-stress.test.ts` | ✅ |
| E14 | Evidence Store | P0 | `scenario-evidence.test.ts`, `@mcpdev/evidence-model` | ✅ |
| E15 | Deterministic Fixtures | P1 | `cow-fixture.test.ts`, `malicious-fixtures.test.ts` | ✅ |
| E16 | Scenario DSL | P1 | `scenario-parser.test.ts`, `scenario-dsl.md` | ✅ |
| E17 | Assertions and Reports | P1 | `scenario-evidence.test.ts` (assertion-result) | ✅ |
| E18 | Protocol Actor | P1 / conditional | `actor-client.test.ts`, `actor-inventory.test.ts` — M2B kararına bağlı | ⚠️ |
| E19 | Security Hardening | P0 | `process-security`, `container-security`, `injection-security`, `recovery-security` | ✅ |
| E20 | Installer and Doctor | P1 | `apps/cli/test/doctor.test.ts` (10 check), install/uninstall | ✅ |
| E21 | Beta Projects | P1 | `three-project-validation.test.ts` (39 tests) | ✅ |
| E22 | Release Engineering | P0 | checksum/SBOM scripts + `release-checklist.md` | ✅ |

✅ = kapanış kanıtı mevcut ve test yeşil · ⚠️ = koşullu açık (M2B)

**Sonuç:** V1'de kapanmayı engelleyen **açık P0 epic yoktur**. Yalnızca E18 koşullu açıktır ve M2B kararına bağlıdır — V1 P0/P1 closed, E18'i M2B dışında tanımladıktan sonra kapatılabilir (bkz. `release-checklist.md` → M2B conditional sonucu kesin).
