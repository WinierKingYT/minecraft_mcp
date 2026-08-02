# Teslimat yol haritası

Tahminler D0C sonunda spike sonuçlarına göre yeniden hesaplanır.

## D0A — Product Freeze

**Tahmin:** 3–5 iş günü · **Çıkış:** Ürün sınırı ve uyumluluk kararı

- [x] V3 sözleşmesini kabul et
- [x] Paper profile'ını repository'ye koy ve **doğrula** — `paper-26.2-build-84-v1.yaml` verified (2026-08-02)
- [x] Java / Node sürüm doğrulaması (Java 25.0.4, Node 24.18.1, pnpm 10.15.0 — profile verified)
- [x] `plugin.yml` resmî, `paper-plugin.yml` experimental kararı (ADR-0005)
- [x] License (MIT)
- [x] Primary MCP client seçimi (custom transport korunacak, V1.1'de SDK'ya geçiş)
- [x] Security claims (ADR-0007)
- [x] M2A/M2B ayrımı (ADR-0006)

## D0B — Feasibility Spikes

**Tahmin:** 7–12 iş günü · **Çıkış:** En riskli teknik bilinmezler

| Spike | Konu |
|---|---|
| [`SPIKE-EXECUTION-CONTAINER-001`](spikes/SPIKE-EXECUTION-CONTAINER-001.md) | Container backend uygulanabilirliği |
| [`SPIKE-WINDOWS-PROCESS-001`](spikes/SPIKE-WINDOWS-PROCESS-001.md) | Windows Job Object ile process tree cleanup |
| [`SPIKE-ACTOR-001`](spikes/SPIKE-ACTOR-001.md) | Protocol test actor |
| [`SPIKE-MCP-SDK-2026-001`](spikes/SPIKE-MCP-SDK-2026-001.md) | MCP 2026 SDK / protokol durumu |
| [`SPIKE-PAPER-DOWNLOAD-001`](spikes/SPIKE-PAPER-DOWNLOAD-001.md) | Paper Downloads Service + checksum |
| [`SPIKE-SAME-JVM-THREAT-001`](spikes/SPIKE-SAME-JVM-THREAT-001.md) | Same-JVM tehdit sınırı |

## D0C — Architecture Freeze

**Tahmin:** 2–3 iş günü

- Spike sonuçlarını ADR'a bağla
- Tool profile'ları kilitle
- Capability registry formatını kilitle
- State machine'leri kilitle
- Roadmap yeniden tahmini
- **Go/no-go**

## M0 — Stable Observation

**Tahmin:** 10–15 iş günü

Monorepo · contracts · MCP stdio · Supervisor IPC skeleton · Paper Bridge lifecycle · loopback auth · capability manifest · server/plugin/world/event read · stable tool facade · evidence skeleton · Inspector · stdout purity · real Paper smoke.

**Demo:**

> AI istemcisi çalışan disposable Paper runtime'ın sürümünü, plugin'lerini, dünyalarını ve event'lerini okur; hiçbir mutation aracı developer profile'da görünmez.

## M1 — Reproducible Build and Launch

**Tahmin:** 18–28 iş günü

Trust store · source snapshot · wrapper verification · dependency locking/verification · Trusted Local · Container backend · build · artifact provenance · runtime image · Paper ready gate · process ownership · recovery · `plugin_build`, `plugin_launch`, `plugin_stop`, `plugin_diagnose`.

**Demo:**

> Kayıtlı kaynağı snapshot al, Container içinde build et, artifact'i disposable Paper runtime'da başlat, plugin enabled kanıtı üret ve temiz kapat.

## M2A — Server-side Deterministic Scenarios

**Tahmin:** 12–18 iş günü

Fixture manifest · determinism profile · disposable runtime per scenario · Scenario DSL · server/plugin/log/event/block assertion'ları · config error scenario · JSON/Markdown/JUnit · evidence provenance.

## M2B — Protocol Actor Scenarios

**Tahmin:** 12–25 iş günü · **Koşul:** `SPIKE-ACTOR-001` başarılı

Actor lifecycle · login · command · native permission · block break · message capture · actor evidence.

## M3 — Security Hardening and Beta

**Tahmin:** 15–25 iş günü

Full security regression · malicious fixtures · quotas · CI matrix · lifecycle stress · installer · doctor · SBOM · üç gerçek proje · dokümantasyon.

## V1 — Stable Local Release

**Tahmin:** 5–10 iş günü stabilization

Koşullar: stable MCP 2.x SDK veya açık release-blocker çözümü · P0/P1 closed · no destructive agent tools · no orphan · no path escape · no secret leak · üç proje · deterministik scenario'lar · install/uninstall · incident response.

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
