# V1 release checklist

> Kanal/milestone durumu: [`status/project-status.yaml`](../../status/project-status.yaml) (tek durum kaynağı).
> Bu liste V1 release gate'idir; prototype kanalında açık kutular beklenendir.

## Ürün

- [x] Hedef kullanıcı ve JTBD onaylı — `docs/product/jtbd.md` (JTBD-01..05)
- [x] V1 kapsamı tek anlamlı — `docs/product/scope.md`
- [x] Non-goals açık — `docs/product/scope.md` (kalıcı non-goal listesi)
- [x] M2B conditional sonucu kesin — SPIKE-ACTOR-001 kısmen başarılı; doğrulanan capability'ler V1'de, kalanlar V1.1'de (bkz. `milestone-acceptance.md` E18)

## Compatibility

- [x] Paper sürüm + build doğrulanmış — `compatibility/paper-26.2-build-84-v1.yaml` (build 84, verified); `paper-download.test.ts`, `compatibility-profiles.test.ts`
- [x] Paper JAR checksum — profil `paper.jar_sha256`; runtime'da `runtime-image.ts:145` re-verify; `runtime-image.test.ts`
- [x] Paper API koordinatı doğrulanmış — profil `paper.api_coordinate` (io.papermc.paper:paper-api:26.2.build.84-stable)
- [x] Java major doğrulanmış — profil `java.runtime_major: 25`; `java-toolchain.test.ts` (JAVA_VERSION_MISMATCH); CI setup-java
- [x] Node sürümü doğrulanmış — profil `node.version: 24.18.1`; `.npmrc engine-strict`; `doctor.test.ts`
- [x] Gradle sürümü doğrulanmış — profil `gradle.wrapper_version: 9.6.1`; `gradle-validation.test.ts`
- [x] Stable MCP SDK release gate karşılanmış — profil `mcp.sdk.channel: stable` (ADR-0010); ADR-0008
- [x] `verification.status: verified` — 3 profil `verification.status: verified`; `compatibility-profiles.test.ts`

## MCP

- [x] stdio — ADR-0002; `conformance-official-client.test.ts` (gerçek stdio process)
- [x] stdout purity — `stdout-purity.test.ts` (CT-MCP-STDOUT-001); conformance test 13
- [x] stable tool list — `tool-surface.test.ts` (TL-01..05); conformance test 04
- [x] input/output schemas — conformance test 05; `tool-result.schema.json`
- [x] success/error union — `docs/contracts/mcp.md`; conformance 08/12
- [x] Resources — `resources/facade.ts` + SDK kaydı; `resource-facade.test.ts` (14 test), conformance 15–18 (templates/list, dayanıklı list, RESOURCE_NOT_FOUND, live-supervisor manifest read)
- [x] Inspector — `docs/operations/mcp-inspector.md`; M0 kabulü
- [x] Gerçek client — `conformance-official-client.test.ts` (14 test, SDK Client 2.0.0)

## Supervisor

- [x] Trust store — `project-registry.ts`; `project-registry.test.ts` (symlink/junction reddi)
- [x] Source snapshot — `source-snapshot.test.ts` (ST-SNAPSHOT-001)
- [x] Operation ledger — `mutation-tracker.ts`; `mutation-tracker.test.ts` (idempotency)
- [x] Process ownership — `ownership.test.ts` (ST-PROC-003, PID-reuse reddi)
- [x] Recovery — `recovery-security.test.ts` (ST-RECOVERY-001)
- [x] Garbage Collector — `runtime-gc.ts`; `runtime-gc.test.ts` (UT-GC-001, state machine)

## Execution

- [x] Trusted Local limitation belgelenmiş — `known-limitations.md`; `guarantees.md`; KPI-11
- [x] Container backend — `container-execution.test.ts` (ST-CONTAINER-EXEC-*)
- [x] No privileged container — `container-security.test.ts` ST-CONTAINER-PRIV-001
- [x] No Docker socket — ST-CONTAINER-SOCKET-001
- [x] No host secrets — ST-CONTAINER-SECRET-001 (env allowlist)
- [x] Quotas — ST-CONTAINER-QUOTA-001..004 (CPU/RAM/PID/disk)
- [x] Network policy — ST-CONTAINER-NET-001 (`--network none`)

## Gradle

- [x] Wrapper JAR verified — `gradle-validation.test.ts` ST-GRADLE-001; CI wrapper-validation
- [x] Distribution SHA — ST-GRADLE-002/004; profil `gradle.distribution_sha256`
- [x] Lock files — ST-GRADLE lock; `install.ts` frozen-lockfile hard fail
- [x] Verification metadata — DEPENDENCY_VERIFICATION_MISSING; `supply-chain.md`
- [x] No dynamic versions — ST-GRADLE-006 (DYNAMIC_DEPENDENCY_FORBIDDEN)
- [x] Strict mode — profil `gradle.verification_mode: strict`

## Paper

- [x] Bridge lifecycle — `PaperBridgePlugin.java` (onEnable/onDisable); `paper-smoke.driver.mjs`
- [x] Ready gate — `minimal.driver.mjs:185` (state READY); `paper-smoke.driver.mjs:96`
- [x] `plugin.yml` — `plugin-metadata.test.ts` (CT-PLUGIN-METADATA-*, gerçek Bridge JAR)
- [x] Plugin enabled — `plugin.enabled` event; e2e-minimal plugin-enables scenario
- [x] Scheduler — `PaperMainThreadExecutor.java` (server scheduler)
- [x] Events — `EventRingBuffer.java`; `event-subscription.test.ts`
- [x] Graceful stop — `paper-smoke.driver.mjs:117`; `minimal.driver.mjs:187`
- [x] Crash evidence — `recovery-security.test.ts`; `lifecycle-stress.test.ts` (0 orphan/100)

## Scenario

- [x] Fresh runtime — `scenario-engine.test.ts` (disposable runtime per scenario); determinism.md DSL-11
- [x] Determinism profile — `docs/contracts/determinism.md` (profil koşuluyor; 20x koşum roadmap kapsam dışı)
- [x] DSL schema — `scenario-parser.test.ts` (18 step allowlist); `scenario-dsl.md`
- [x] Assertions — `scenario-engine.test.ts` (expected/actual/attempts/duration)
- [x] Eventual waits — `scenario-engine.test.ts` (`within` keyword, polling)
- [x] Cleanup — `scenario-engine.test.ts`; `scenario-report.test.ts` (ayrı raporlanır)
- [x] Reports — `scenario-report.test.ts` (JSON/Markdown/JUnit XML)

## Security

- [x] Path traversal — ST-PATH-001, ST-ARCHIVE-001, ST-CONTAINER-EXPORT-001
- [x] Symlink/junction — `source-snapshot.test.ts`; `project-registry.test.ts` (junction)
- [x] Archive traversal — `plugin-metadata.test.ts` ST-ARCHIVE-001/002 (zip-bomb)
- [x] Token redaction — `scenario-evidence.test.ts`; `persistent-registry.test.ts`; BR-05
- [x] Handle ownership — `ownership.test.ts` (ST-PROC-003); `ipc.test.ts`
- [x] Idempotency — `mutation-tracker.test.ts`; `scenario-engine.test.ts`
- [x] Malicious Gradle — `gradle-validation.test.ts`; `build-pipeline.test.ts` (JAVA_TOOL_OPTIONS reddi); ST-PROC-002
- [x] Malicious plugin container testi — `malicious-container.test.ts` (ST-MALICIOUS-CONTAINER-001/002 hermetic her platformda; 003 canlı probe Docker varsa); `hostile-probe` + `spike-container-check.ts` canlı deney olarak kalır
- [x] Same-JVM limitation belgelenmiş — `guarantees.md`; `known-limitations.md`; SPIKE-SAME-JVM-001 (closed)

## Release

- [x] Windows/Linux CI — `typescript` + `security` matrix [ubuntu, windows]
- [x] SBOM — `generate-sbom.mjs`; CI `sbom` job (>=50 component)
- [x] Checksums — `generate-checksums.mjs`; CI `checksum` job
- [x] Standalone paket — `build-standalone.mjs` (tarball + SHASUMS/`.sha256`); CI `standalone` job (temiz kurulum → doctor layout standalone → config); ADR-0014
- [x] Install/uninstall — `mcpdev install`/`mcpdev uninstall` (`apps/cli/`); kılavuz: `docs/operations/install.md`
- [x] Doctor — `doctor.test.ts`; CI `doctor` job; `docs/operations/troubleshooting.md`
- [x] Troubleshooting — `docs/operations/troubleshooting.md`
- [x] Incident response — `docs/operations/incident-response.md`
- [x] Known limitations — `docs/operations/known-limitations.md`
- [x] Üç gerçek proje — `three-project-validation.test.ts` (39 test, minimal/medium/complex)
- [x] P0/P1 closed — tüm P0/P1 epic'ler kapanış kanıtıyla kilitlendi; E18 koşullu konsepti SPIKE-ACTOR-001 ile karara bağlandı (kısmen başarılı, doğrulanan capability'ler V1'de) — matris: `milestone-acceptance.md`

## V1.1 çıkış koşulları

V1.1 yedi yatay yeteneği paketler. V1'den ayrı çıkış, V1 sınırına (destructive agent tool, orphan, path escape, secret leak) dokunmadığı sürece yapılabilir.

- [x] Event subscription — filtrelenen olaylar doğru istemciye ulaşır (`event-subscription.test.ts`; `integration-v11.test.ts`)
- [x] Runtime pool — runtime yeniden kullanımı image bazlı ve reuse-count limitli (`runtime-pool.test.ts`)
- [x] İkinci Paper profili — multi-profile diverjans `checkSecondProfile` ile teşhis edilir (`apps/cli/src/doctor.ts`; `compatibility-profiles.test.ts` ≥3 profil)
- [x] Performance profiler — metrikler çıkar (`performance-profiler.test.ts`)
- [x] Permission — geçici izin, `runtime_discard` ile geri alınır (kalıcı izin yok) (`permission-adapter.test.ts`)
- [x] Copy-on-write fixture — immutable (`cow-fixture.test.ts`)
- [x] Actor inventory — envanter izlenir (`actor-inventory.test.ts`)
- [x] MCP yüzeyi — read-only V1.1 tool'ları developer profilinde; mutation tool'ları debug'da; R4 `pool_evict`/`pool_reset` hiçbir profilde yok (`packages/capability-registry/profiles.yaml`; `v11-tools.test.ts`; `v11-e2e.test.ts`)
- [x] Capability registry yeşil — `validate-registry.mjs` (51 capability, 113 error, 3 profil)
- [x] E2E + entegrasyon + unit testleri istikrarlı (`v11-e2e.test.ts` CT-MCP-V11-E2E-001; `integration-v11.test.ts` CT-INT-V11-001)
- [x] Doctor V1.1 check'leri (`compatibility_profiles`, `capability_registry`) geçer (`doctor.test.ts` — checkSecondProfile, checkCapabilityRegistry)

## Release artifact'leri

MCP package · Supervisor package · Bridge JAR · Actor package (M2B açıksa) · compatibility profile · capability registry · JSON schemas · error catalog · SBOM · checksums · changelog · migration notes · known limitations · install/uninstall · incident response.

> **GitHub Release dağıtım notu (v0.1.0-prototype.0):** Tarball'lar GitHub Release
> üzerinden arşiv olarak dağıtılır (`.github/workflows/release.yml`, tag `v*`).
> Phase 2'den itibaren **standalone `mcpdev` tarball'ı** `npm install <tgz>` ile
> kurulabilir ([ADR-0014](../adr/0014-standalone-distribution.md),
> [`scripts/build-standalone.mjs`](../../scripts/build-standalone.mjs)); bundle
> içindeki `@mcpdev/*` paketleri registry yayını gerektirmez. Yayın kararı
> (npm / GitHub Packages registry) ayrı bir sürümle alınır.

## Sürümlenen bileşenler

```text
MCP Server version
Run Supervisor version
Bridge Plugin version
Actor version
Bridge Protocol version
Scenario DSL version
Config Schema version
Capability Registry version
Plugin Test Contract version
Compatibility Profile version
```
