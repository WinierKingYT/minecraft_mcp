# Teslimat belgeleri

| Belge | İçerik |
|---|---|
| [`roadmap.md`](roadmap.md) | D0A → V1 aşamaları, tahminler, demo tanımları |
| [`milestone-acceptance.md`](milestone-acceptance.md) | Milestone kabul kriterleri |
| [`epics.md`](epics.md) | Backlog epikleri (E01–E22) |
| [`risk-register.md`](risk-register.md) | Risk kaydı |
| [`release-checklist.md`](release-checklist.md) | V1 release checklist ve artifact listesi |
| [`beyond-v1.md`](beyond-v1.md) | V1.1 / V2 adayları ve **yasak genişleme biçimleri** |
| [`spikes/`](spikes/) | D0B feasibility spike'ları |

## Mevcut aşama

**D0C — Architecture Freeze: tamamlandı (2026-08-07) · Karar: GO**

- Tüm D0B spike'ları closed ve ilgili ADR'larına bağlandı (CONTAINER→ADR-0004, ACTOR→ADR-0006, MCP-SDK→ADR-0002, SAME-JVM→ADR-0007, WINDOWS-PROCESS→Trusted Local, PAPER-DOWNLOAD→profiller).
- Tool profile'ları, capability registry formatı ve state machine'ler D0C itibarıyla **donmuştur** (değişiklik ADR gerektirir).
- Roadmap tahminleri gerçek ilerlemeye göre yeniden hesaplandı (M0 ✅, M1 🔶 kalan 5–10 iş günü).
- Sıradaki aşama: **M1 — Reproducible Build and Launch** (kalan iş listesi [`roadmap.md`](roadmap.md)'de).

## Güncel aşama

**M1 — Reproducible Build and Launch: ✅ tamamlandı (2026-08-08)**

- Build → launch dikey dilimi her iki backend'de canlı koşuldu: build edilen plugin disposable Paper runtime'da başlatıldı (enabled=true kanıtı), diagnose üretildi, temiz kapanış ve GC 0 kalıntı.
- Reproducible build kanıtı: trusted-local ve container **birebir aynı artifact sha256** (`4a82aae89b...`) üretti.
- Kılavuz: [`../operations/m1-demo.md`](../operations/m1-demo.md) · Roadmap: [`roadmap.md`](roadmap.md)
- Sıradaki aşama: **M2A — Server-side Deterministic Scenarios**.
