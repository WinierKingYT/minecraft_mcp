# Milestone kabul kriterleri

Bu kriterler [`roadmap.md`](roadmap.md) ve [`release-checklist.md`](release-checklist.md) ile çelişemez (DOC-GATE-01).

## D0

- [x] Uyumluluk profile repository'de **ve doğrulanmış** (`compatibility/` — 3 verified profil)
- [x] Sürüm placeholder'ı bulunmuyor (`check:docs` placeholder taraması yeşil)
- [x] Karar placeholder'ı bulunmuyor (`check:docs` placeholder taraması yeşil)
- [x] ExecutionBackend kararı (ADR-0004)
- [x] Actor go/no-go (SPIKE-ACTOR-001 — closed, kısmen başarılı; E18)
- [x] MCP SDK risk kararı (ADR-0002, ADR-0010)
- [x] Threat model (`docs/security/threat-model.md`)
- [x] ADR seti (`docs/adr/` — 11 ADR)

## M0

- [x] Bridge dış interface'e bind etmez (`process-security.test.ts`)
- [x] Yanlış token reddedilir (`process-security.test.ts`)
- [x] Tool list sabit ve deterministik (`tool-surface.test.ts` — TL-01..05)
- [x] stdout temiz (`stdout-purity.test.ts`)
- [x] Inspector geçer (`docs/operations/mcp-inspector.md`, official client E2E)
- [x] Real Paper 5 lifecycle (`docs/operations/m0-smoke.md` — canlı koşum)
- [x] Plugin disable sonrası Bridge thread/port kalmaz (`lifecycle-stress.test.ts` — 0 orphan/100 cycle)

## M1

- [x] Source snapshot'tan artifact'e provenance (`source-snapshot.test.ts`, `build-pipeline.test.ts`)
- [x] Wrapper verification (`gradle-validation.test.ts` — ST-GRADLE-001)
- [x] Lock/verification strict (`install.ts` frozen-lockfile hard fail, `gradle-validation.test.ts`)
- [x] Container no-network testi (`container-security.test.ts` — ST-CONTAINER-NO-NET-001)
- [x] Artifact ambiguity güvenli hata (`build-pipeline.test.ts` — IT-BUILD-001)
- [x] Wrong Java güvenli hata (`java-toolchain.test.ts`)
- [x] Paper ready gate (`docs/operations/m1-demo.md` — canlı koşum)
- [x] MCP crash sonrası Supervisor recovery (`recovery-security.test.ts`)
- [x] Windows/Linux cleanup (`process-security.test.ts` — taskkill /T, docs/operations/m1-demo.md)

## M2A

- [x] 3 server-side scenario (6 scenario canlı koştu — `docs/operations/m2a-demo.md`)
- [ ] 20 fresh runtime determinism (roadmap kapsam dışı ilanı; determinism profile koşuluyor)
- [x] Expected/observed (`scenario-report.ts` — assertion expected/actual görünürlüğü)
- [x] Cleanup ayrı raporlanır (`scenario-report.ts` cleanup raporlaması, GC kalıntısız koşumlar)
- [x] Evidence report (`scenario-evidence.test.ts`, content-addressed store)
- [x] Scenario cross-contamination yok (`malicious-fixtures.test.ts`)

## M2B

- [x] Actor 100 lifecycle (`m2b-actor-scenarios.test.ts` — 100 `test_actor.create`, hepsi connected, `disconnect_all` ile hepsi bağlantısız)
- [x] Join/quit (`m2b-actor-scenarios.test.ts` — tam yaşam döngüsü: create → get_state → look → move → chat → disconnect_all → `connected: false`)
- [x] Command (`m2b-actor-scenarios.test.ts` — `plugin.command` actor bağlamında dispatch edilir)
- [x] Permission (`m2b-actor-scenarios.test.ts` — yetkisiz gamemode `dispatch_ok=false`, player.command event'i; ADR-0006)
- [x] Block interaction (`m2b-actor-scenarios.test.ts` — `player.break_block` blok air olur, `block.break` event'i)
- [x] Message capture (`scenario-engine.test.ts` — `assert.player_message` ring buffer gerçek capture; `m2b-actor-scenarios.test.ts` — chat + player.message event'i)
- [x] Actor crash cleanup (`m2b-actor-scenarios.test.ts` — DSL-10: `when` fazında ACTOR_CRASHED olsa da `test_actor.disconnect_all` cleanup'i koşar; engine düzeltmesi `scenario-engine.ts` `#runCleanup`)

M2B kapanış detayı: `docs/operations/m2b-demo.md` (canlı Paper koşumu), canlı doğrulama `m2a-demo` kalıbıyla.

## M3

- [x] Security regression green (`security` CI job — process, container, injection, recovery, backend-downgrade, lifecycle-stress, three-project, malicious-fixtures)
- [x] P0 yok (366 tests pass, 0 fail, no critical issues)
- [x] Secret leak yok (`process-security.test.ts` — ST-ENV-001..006)
- [x] Path escape yok (`process-security.test.ts` — ST-PATH-001)
- [x] Container host secret erişimi yok (`container-security.test.ts` — ST-CONTAINER-SECRET-001)
- [x] 100 lifecycle orphan `%0` (`lifecycle-stress.test.ts` — ST-LIFECYCLE-001, 0 orphans in 100 cycles)
- [x] Doctor doğru teşhis (`apps/cli/`, `doctor` CI job, 10 health checks — V1.1'de `compatibility_profiles` ve `capability_registry` eklendi)
- [x] Üç gerçek proje (`fixtures/projects/`, `three-project-validation.test.ts` — 39 tests)
- [x] Dependency vulnerability scan (`dependency-scan` CI job — `scripts/dependency-scan.mjs`, OSV; pnpm+gradle lockfile purl'ları; HIGH+ bulgular allowlist'te değilse gate kırmızı)

## V1.1

V1.1, V1 sınırına dokunmadan yedi yatay yeteneği paketler: event-driven gözlem, runtime yeniden kullanımı, multi-profile diverjans, performans görünürlüğü, geçici izin yönetimi, immutable fixture'lar ve actor envanteri.

- [x] Event subscription: olay filtresi (tip/actor), TTL, buffer limiti, eşzamanlı abonelikler (`event-subscription.test.ts`, `integration-v11.test.ts`)
- [x] Runtime pool: acquire/release/evict/reset, image bazlı yeniden kullanım, reuse-count limiti (`runtime-pool.test.ts`)
- [x] Multi-profile diverjans: `paper-26.2-build-84-v1`, `-87-v1`, `-90-v1` (üçü de verified, aktif) — `checkSecondProfile` doctor check ≥2 verified profil arar (geçer); `compatibility-profiles.test.ts` ≥3 profili doğrular
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
- [x] P0/P1 closed

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
| E18 | Protocol Actor | P1 / conditional | `actor-client.test.ts` (14), `actor-inventory.test.ts` (10) — SPIKE-ACTOR-001 kısmen başarılı; doğrulanan capability'ler V1'de, kalanlar V1.1'de | ✅ |
| E19 | Security Hardening | P0 | `process-security`, `container-security`, `injection-security`, `recovery-security` | ✅ |
| E20 | Installer and Doctor | P1 | `apps/cli/test/doctor.test.ts` (10 check), install/uninstall | ✅ |
| E21 | Beta Projects | P1 | `three-project-validation.test.ts` (39 tests) | ✅ |
| E22 | Release Engineering | P0 | checksum/SBOM scripts + `release-checklist.md` | ✅ |

✅ = kapanış kanıtı mevcut ve test yeşil · ⚠️ = koşullu açık (M2B)

**Sonuç:** Tüm P0/P1 epic'ler kapanış kanıtıyla kilitlendi. E18 (Protocol Actor) koşullu konsepti SPIKE-ACTOR-001 ile karara bağlandı: kısmen başarılı — `test_actor.protocol`, `player.break_block`, `player.move`, `player.look`, `player.chat`, `plugin.command.typed`, `actor.disconnect` doğrulandı ve V1'de; `actor.message.read` ve `player.state.read` V1.1'de derinleştirilecek. V1 P0/P1 closed durumundadır.
