# ADR-0001 — Deployable process topolojisi

**Durum:** accepted
**Tarih:** 2026-07-29
**Bağlam:** REQ-005, REQ-006; [`../architecture/process-topology.md`](../architecture/process-topology.md)

## Bağlam

Ürün beş farklı sorumluluk taşıyor: MCP protokol yüzeyi, uzun süren build/runtime orkestrasyonu, gerçek Paper sunucusu, Paper içi gözlem/mutation ve gerçek oyuncu semantiği. Bunları tek process'e koymak şu sorunları üretir:

- MCP Server çökmesi Paper process sahipliğini kaybettirir → orphan process (KPI-06 ihlali).
- Paper JVM'i ile aynı adres alanında çalışan bir orkestrasyon katmanı, hedef plugin'in erişim yüzeyini genişletir.
- Uzun süren build'ler stdio döngüsünü bloke eder.

## Karar

Dört **deployable process** tanımlanır: MCP Server, Run Supervisor, Paper Server, Protocol Test Actor (koşullu).

Aşağıdakiler **ayrı process değildir**:

| Bileşen | Nerede |
|---|---|
| Paper Bridge | Paper process'i içinde Java eklentisi |
| Policy Engine, Scenario Coordinator, Schema Registry, Evidence API | MCP Server modülleri |
| Build Executor, Source Snapshotter, Runtime Registry, Operation Ledger, Mutation Ledger, Retention Manager, Garbage Collector, Startup Recovery | Run Supervisor modülleri |

MCP Server şunları **yapmaz**: doğrudan shell çalıştırma, Paper process sahipliği taşıma, runtime klasörü silme, stdout'a protokol dışı veri yazma.

## Alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| Tek process (MCP + orkestrasyon) | MCP çökmesi orphan process bırakır; KPI-06 kanıtlanamaz |
| Bridge'i ayrı process yapmak | Paper API'ye erişim yalnızca Paper JVM'i içinden mümkün; ayrı process ek IPC katmanı ekler ve hiçbir güvenlik kazancı sağlamaz (aynı JVM sınırı yine gerekir) |
| Policy Engine'i ayrı process yapmak | Policy her tool çağrısında senkron çalışır; ek process gecikme ekler, izolasyon kazancı yok (MCP Server ile aynı güven sınıfı) |
| Supervisor'ı thread pool olarak MCP içine almak | Aynı çökme sorunu; ayrıca process ownership'in OS düzeyinde ayrı bir sahibi olmaz |

## Sonuçlar

**Olumlu**

- MCP Server çökmesi process ownership'i kaybettirmez (ADR-0003 ile birlikte).
- Uzun operation'lar stdio döngüsünü bloke etmez.
- Paper JVM'i minimum bileşen taşır.

**Olumsuz**

- İki host process arasında typed IPC katmanı gerekir.
- Geliştirme sırasında iki process'i birlikte başlatmak/izlemek gerekir.
- Hata teşhisi iki log kaynağını korele etmeyi gerektirir → `correlation_id` zorunlu.

**Kanıt:** `IT-RUNTIME-001`, `ST-RECOVERY-001`, `CT-MCP-STDOUT-001`.

## İlgili

- [`../architecture/process-topology.md`](../architecture/process-topology.md)
- [ADR-0003](0003-run-supervisor-process.md)
- KPI-06
