# Ürün tanımı, hedef kullanıcılar ve Jobs to Be Done

## Birincil hedef kullanıcı

> AI kodlama ajanıyla Paper eklentisi geliştiren ve yapılan değişikliğin gerçek Paper sunucusunda derlenip davranış olarak çalıştığını otomatik doğrulamak isteyen Minecraft Java geliştiricisi.

## İkincil hedef kullanıcılar

- Pull request üzerinde build ve davranış doğrulaması yapmak isteyen plugin ekipleri
- Regression test altyapısı kuran teknik liderler
- Farklı plugin sürümlerini sabit fixture üzerinde sınayan QA geliştiricileri
- AI tarafından üretilen kodu disposable ortamda test etmek isteyen platform mühendisleri

## Hedeflenmeyen kullanıcılar

Bu kullanıcıların ihtiyaçları V1 tasarımını **yönlendirmez**:

- Canlı sunucuyu AI ile yöneten sunucu sahipleri
- Oyunculara doğrudan LLM sağlayan plugin geliştiricileri
- Fabric istemci modu geliştiricileri
- Bedrock Script API geliştiricileri
- Survival oynayan veya yol bulan genel amaçlı bot üreticileri
- Çok kullanıcılı SaaS arayan ekipler
- Plugin marketine otomatik yayın sistemi arayanlar

---

## JTBD-01 — Build doğrulama

> Bir agent plugin kodunu değiştirdiğinde, doğru Java ve Gradle ortamında derlenip derlenmediğini ve hata varsa dosya, satır, sembol ve önerilen düzeltmeyle görmek istiyorum.

| Alan | Değer |
|---|---|
| Capability | `project.inspect`, `project.validate`, `build.run` |
| Epic | E09, E10, E11, E12 |
| Milestone | M1 |
| KPI | KPI-02, KPI-08 |
| Evidence | `build-log`, `compiler-diagnostics`, `artifact-manifest` |

## JTBD-02 — Gerçek Paper startup doğrulaması

> Plugin derlendiğinde, temiz Paper runtime içinde yüklenip `enabled` olduğunu ve kritik startup hatası üretmediğini doğrulamak istiyorum.

| Alan | Değer |
|---|---|
| Capability | `runtime.lifecycle`, `plugin.launch`, `plugin.state.read` |
| Epic | E07, E13 |
| Milestone | M1 |
| KPI | KPI-03, KPI-04 |
| Evidence | `runtime-log`, `plugin-state`, `ready-gate-proof` |

## JTBD-03 — Davranış testi

> Bir command, permission veya event davranışı değiştiğinde, deterministik başlangıç durumunda gerçek Paper üzerinde doğru çalıştığını otomatik sınamak istiyorum.

| Alan | Değer |
|---|---|
| Capability | `scenario.run`, `world.block.read`, `world.block.write`, `events.read`, `test_actor.protocol` |
| Epic | E15, E16, E17, E18 |
| Milestone | M2A / M2B |
| KPI | KPI-05 |
| Evidence | `event-log`, `assertion-result`, `block-observation` |

## JTBD-04 — Kanıtlanabilir hata teşhisi

> Test başarısız olduğunda yalnızca "başarısız" değil; source snapshot, artifact, log, event, expected/observed ve cleanup sonucunu birlikte görmek istiyorum.

| Alan | Değer |
|---|---|
| Capability | `evidence.read`, `report.generate` |
| Epic | E14, E17 |
| Milestone | M1 / M2A |
| KPI | KPI-08, KPI-09 |
| Evidence | `report-manifest`, `provenance-chain` |

## JTBD-05 — Güvenli cleanup

> Test bittiğinde Paper, test actor, port, token ve geçici dosyaların kontrolsüz biçimde açık kalmadığından emin olmak istiyorum.

| Alan | Değer |
|---|---|
| Capability | `runtime.lifecycle`, `runtime.release` |
| Epic | E13, E19 |
| Milestone | M1 / M3 |
| KPI | KPI-06, KPI-07, KPI-12 |
| Evidence | `cleanup-result`, `port-release-proof`, `process-tree-proof` |
