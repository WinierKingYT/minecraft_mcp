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
- [x] İkinci Paper profili: `paper-26.2-build-87-v1` diverjans için; `checkSecondProfile` doctor check ≥2 verified profil arar
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
