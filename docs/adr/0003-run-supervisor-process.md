# ADR-0003 — Ayrı Run Supervisor process'i

**Durum:** accepted
**Tarih:** 2026-07-29
**Bağlam:** REQ-005, REQ-009, REQ-010; KPI-06, KPI-07

## Bağlam

Build ve Paper runtime'ı başlatan taraf, o process'lerin **sahibidir**: PID'lerini, process grubunu/Job Object'ini, runtime marker'ını ve silme yetkisini elinde tutar. Bu sahiplik MCP Server'ın ömrüne bağlanırsa, MCP Server'ın çökmesi veya istemcinin bağlantıyı kesmesi sahipsiz Paper JVM'leri bırakır.

## Karar

Process ownership, build yürütme ve runtime yaşam döngüsü **ayrı bir Run Supervisor process'inde** yaşar.

Supervisor modülleri: Project Registry · Trust Store client · Source Snapshotter · Execution Backend manager · Build Executor · Runtime Registry · Process Ownership Manager · Operation Ledger · Mutation Ledger · Retention Manager · Garbage Collector · Startup Recovery.

Zorunlu davranışlar:

1. Supervisor, MCP Server çöktüğünde de ownership bilgisini korur.
2. Supervisor yeniden başladığında **startup recovery** çalıştırır; kayıtlı ama artık geçerli olmayan process'leri tespit eder.
3. PID tek başına yeterli değildir: PID + executable path + process start time + runtime marker fingerprint eşleşmeli. Eşleşmezse `PROCESS_OWNERSHIP_MISMATCH` ve **öldürme yapılmaz**.
4. Runtime silme yalnızca Garbage Collector'a aittir; agent `DELETING` geçişini tetikleyemez.
5. Silme, dry-run validation olmadan başlamaz.

## Alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| Ownership'i MCP Server'da tutmak | MCP çökmesi orphan bırakır; KPI-06 `%0` hedefi kanıtlanamaz |
| Ownership'i dosya tabanlı kilitlerle paylaşmak | İki process'in aynı anda öldürme kararı vermesi mümkün; PID reuse ile yanlış process öldürülebilir |
| Sadece PID kaydetmek | PID reuse (özellikle Windows'ta) yanlış process'in öldürülmesine yol açar |
| Agent'a runtime delete yetkisi vermek | KPI-07 ihlali; yanlış kök silme riski |

## Sonuçlar

**Olumlu**

- Orphan process tespiti ve kurtarma tek bir yerde toplanır.
- Yanlış process öldürme yapısal olarak engellenir.
- Disk kullanımı retention + GC ile sınırlanır.

**Olumsuz**

- İki host process arasında typed IPC ve sürüm uyumluluğu gerekir.
- Supervisor'ın kendisi çökerse recovery'nin doğruluğu kritik hâle gelir → `ST-RECOVERY-001` zorunlu.
- Geliştirme ergonomisi düşer (iki process).

**Kanıt:** `ST-PROC-003`, `ST-CLEANUP-001..003`, `ST-RECOVERY-001`, 100 lifecycle orphan `%0` testi.

## İlgili

- [ADR-0001](0001-process-topology.md)
- [`../architecture/state-machines.md`](../architecture/state-machines.md)
- [`../delivery/spikes/SPIKE-WINDOWS-PROCESS-001.md`](../delivery/spikes/SPIKE-WINDOWS-PROCESS-001.md)
