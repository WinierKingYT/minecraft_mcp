# V1 release checklist

## Ürün

- [ ] Hedef kullanıcı ve JTBD onaylı
- [ ] V1 kapsamı tek anlamlı
- [ ] Non-goals açık
- [ ] M2B conditional sonucu kesin

## Compatibility

- [ ] Paper sürüm + build doğrulanmış
- [ ] Paper JAR checksum
- [ ] Paper API koordinatı doğrulanmış
- [ ] Java major doğrulanmış
- [ ] Node sürümü doğrulanmış
- [ ] Gradle sürümü doğrulanmış
- [ ] Stable MCP SDK release gate karşılanmış
- [ ] `verification.status: verified`

## MCP

- [ ] stdio
- [ ] stdout purity
- [ ] stable tool list
- [ ] input/output schemas
- [ ] success/error union
- [ ] Resources
- [ ] Inspector
- [ ] Gerçek client

## Supervisor

- [ ] Trust store
- [ ] Source snapshot
- [ ] Operation ledger
- [ ] Process ownership
- [ ] Recovery
- [ ] Garbage Collector

## Execution

- [ ] Trusted Local limitation belgelenmiş
- [ ] Container backend
- [ ] No privileged container
- [ ] No Docker socket
- [ ] No host secrets
- [ ] Quotas
- [ ] Network policy

## Gradle

- [ ] Wrapper JAR verified
- [ ] Distribution SHA
- [ ] Lock files
- [ ] Verification metadata
- [ ] No dynamic versions
- [ ] Strict mode

## Paper

- [ ] Bridge lifecycle
- [ ] Ready gate
- [ ] `plugin.yml`
- [ ] Plugin enabled
- [ ] Scheduler
- [ ] Events
- [ ] Graceful stop
- [ ] Crash evidence

## Scenario

- [ ] Fresh runtime
- [ ] Determinism profile
- [ ] DSL schema
- [ ] Assertions
- [ ] Eventual waits
- [ ] Cleanup
- [ ] Reports

## Security

- [ ] Path traversal
- [ ] Symlink/junction
- [ ] Archive traversal
- [ ] Token redaction
- [ ] Handle ownership
- [ ] Idempotency
- [ ] Malicious Gradle
- [ ] Malicious plugin container testi
- [ ] Same-JVM limitation belgelenmiş

## Release

- [ ] Windows/Linux CI
- [ ] SBOM
- [ ] Checksums
- [ ] Install/uninstall
- [ ] Doctor
- [ ] Troubleshooting
- [ ] Incident response
- [ ] Known limitations
- [ ] Üç gerçek proje
- [ ] P0/P1 closed — açık P0 epic yok; E18 (Protocol Actor) M2B kararına bağlı koşullu açık. M2B V1 dışına tanımlanınca kapanır (matris: `milestone-acceptance.md`)

## V1.1 çıkış koşulları

V1.1 yedi yatay yeteneği paketler. V1'den ayrı çıkış, V1 sınırına (destructive agent tool, orphan, path escape, secret leak) dokunmadığı sürece yapılabilir.

- [ ] Event subscription — filtrelenen olaylar doğru istemciye ulaşır
- [ ] Runtime pool — runtime yeniden kullanımı image bazlı ve reuse-count limitli
- [ ] İkinci Paper profili — multi-profile diverjans `checkSecondProfile` ile teşhis edilir
- [ ] Performance profiler — metrikler çıkar
- [ ] Permission — geçici izin, `runtime_discard` ile geri alınır (kalıcı izin yok)
- [ ] Copy-on-write fixture — immutable
- [ ] Actor inventory — envanter izlenir
- [ ] MCP yüzeyi — read-only V1.1 tool'ları developer profilinde; mutation tool'ları debug'da; R4 `pool_evict`/`pool_reset` hiçbir profilde yok
- [ ] Capability registry yeşil — `validate-registry.mjs` (46 capability, 109 error, 3 profil)
- [ ] E2E + entegrasyon + unit testleri istikrarlı
- [ ] Doctor V1.1 check'leri (`compatibility_profiles`, `capability_registry`) geçer

## Release artifact'leri

MCP package · Supervisor package · Bridge JAR · Actor package (M2B açıksa) · compatibility profile · capability registry · JSON schemas · error catalog · SBOM · checksums · changelog · migration notes · known limitations · install/uninstall · incident response.

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
