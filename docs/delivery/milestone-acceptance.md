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
- [x] Doctor doğru teşhis (`apps/cli/`, `doctor` CI job, 8 health checks)
- [x] Üç gerçek proje (`fixtures/projects/`, `three-project-validation.test.ts` — 39 tests)

## V1

- [x] Stable SDK policy karşılandı (ADR-0008 — SDK blocker kaldırıldı, `TransportAdapter` korundu)
- [x] Tüm release artifact'leri checksum ve SBOM taşıyor (`scripts/generate-checksums.mjs`, `scripts/generate-sbom.mjs`, `checksum` CI job)
- [x] Install/uninstall mevcut (`apps/cli/` — `mcpdev install`, `mcpdev uninstall`)
- [x] Known limitations açık (`docs/operations/known-limitations.md`)
- [x] Compatibility manifest mevcut (`docs/operations/compatibility-manifest.md`)
- [x] Incident response mevcut (`docs/operations/incident-response.md`)
- [x] Documentation gates geçiyor (`pnpm run check:docs` — 79 files pass)
- [ ] P0/P1 closed
