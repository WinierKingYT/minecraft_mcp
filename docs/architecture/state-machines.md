# Durum makineleri

> **D0C kilidi (2026-08-07):** Bu durum makineleri Architecture Freeze itibarıyla **donmuştur**. Yeni durum veya geçiş ADR gerektirir; terminal durumların anlamları `UNKNOWN_OUTCOME` semantiği (kör retry yasağı) ve `DIRTY` (KPI-12) ile birlikte değiştirilemez.

## Run

```mermaid
stateDiagram-v2
    [*] --> CREATED
    CREATED --> SNAPSHOTTING_SOURCE
    SNAPSHOTTING_SOURCE --> PREPARING_BUILD
    PREPARING_BUILD --> BUILDING
    BUILDING --> PREPARING_RUNTIME
    PREPARING_RUNTIME --> STARTING_RUNTIME
    STARTING_RUNTIME --> READY
    READY --> EXECUTING_SCENARIO
    EXECUTING_SCENARIO --> COLLECTING_EVIDENCE
    COLLECTING_EVIDENCE --> CLEANING_UP
    CLEANING_UP --> COMPLETED

    CREATED --> FAILED
    SNAPSHOTTING_SOURCE --> FAILED
    PREPARING_BUILD --> FAILED
    BUILDING --> FAILED
    PREPARING_RUNTIME --> FAILED
    STARTING_RUNTIME --> FAILED
    READY --> FAILED
    EXECUTING_SCENARIO --> FAILED
    COLLECTING_EVIDENCE --> FAILED

    BUILDING --> CANCELLED
    STARTING_RUNTIME --> CANCELLED
    EXECUTING_SCENARIO --> CANCELLED

    BUILDING --> TIMED_OUT
    STARTING_RUNTIME --> TIMED_OUT
    EXECUTING_SCENARIO --> TIMED_OUT

    CLEANING_UP --> DIRTY
    STARTING_RUNTIME --> ORPHANED
    EXECUTING_SCENARIO --> UNKNOWN_OUTCOME
```

Terminal durumlar: `COMPLETED` · `FAILED` · `CANCELLED` · `TIMED_OUT` · `DIRTY` · `ORPHANED` · `UNKNOWN_OUTCOME`

| Terminal durum | Anlam |
|---|---|
| `COMPLETED` | Akış bitti; scenario sonucu ayrı alanda taşınır |
| `FAILED` | Beklenen bir hata sınıfı; kod + suggested action taşır |
| `CANCELLED` | Kullanıcı/agent iptali |
| `TIMED_OUT` | Limit aşımı |
| `DIRTY` | Ana iş bitti fakat **cleanup başarısız** — ana sonucu gizlemez (KPI-12) |
| `ORPHANED` | Sahipsiz process tespit edildi; recovery gerekir |
| `UNKNOWN_OUTCOME` | Sonucun uygulanıp uygulanmadığı bilinmiyor; **otomatik retry edilmez** |

## Operation

```text
CREATED
  -> QUEUED
  -> RUNNING
  -> SUCCEEDED | FAILED | TIMED_OUT
  -> CANCELLING
  -> CANCELLED | FAILED
```

## Runtime

```mermaid
stateDiagram-v2
    [*] --> NEW
    NEW --> CREATING
    CREATING --> CREATED
    CREATING --> FAILED
    CREATED --> STARTING
    STARTING --> READY
    STARTING --> FAILED
    STARTING --> CRASHED
    READY --> STOPPING
    READY --> CRASHED
    STOPPING --> STOPPED
    STOPPING --> FORCE_STOPPING
    FORCE_STOPPING --> FORCE_STOPPED
    STOPPING --> CRASHED
    STOPPED --> RELEASED
    FORCE_STOPPED --> RELEASED
    CRASHED --> RELEASED
    FAILED --> RELEASED
    RELEASED --> RETENTION
    RETENTION --> DELETE_VALIDATION
    DELETE_VALIDATION --> DELETING
    DELETING --> DELETED
    DELETED --> [*]
```

**Karar:** Agent `DELETING` işlemi başlatamaz. `RETENTION -> DELETE_VALIDATION -> DELETING` geçişleri yalnızca Garbage Collector tarafından, dry-run validation sonrasında yapılır.

## Scenario

```text
VALIDATING
  -> PREPARING
  -> EXECUTING_GIVEN
  -> EXECUTING_WHEN
  -> ASSERTING
  -> COLLECTING_EVIDENCE
  -> CLEANING_UP
  -> PASSED | FAILED | CANCELLED | TIMED_OUT | DIRTY
```

Cleanup **her** terminal durumda denenir; cleanup sonucu scenario sonucundan ayrı raporlanır.

## Mutation

```text
RECEIVED
  -> VALIDATED
  -> SCHEDULED
  -> APPLYING
  -> APPLIED | FAILED | UNKNOWN_OUTCOME
```

`UNKNOWN_OUTCOME` durumunda agent önce mutation status sorgular; kör retry yasaktır.
