# Test stratejisi

## Katmanlar

### Unit

Schema · capability generation · error mapping · policy · trust · snapshot · path confinement · symlink/junction · redaction · state machines · idempotency · artifact selection · event cursor · report generation.

### Paper mock

Listener serialization · scheduler service · command registry · native permission helper · lifecycle cleanup.

> **Mock gerçek Paper yerine geçmez.** Mock'ta geçen bir davranış, gerçek Paper smoke testi olmadan kanıtlanmış sayılmaz.

### Contract

TypeScript/Java schema pariteleri · Bridge authentication · Host/Origin · body limit · timeout · queue · error catalog · capability manifest · protocol mismatch · idempotency.

### Real Paper

Paper (profildeki sürüm/build) · Java (profildeki major) · Bridge JAR · örnek hedef plugin · fixture · startup/stop/crash · event behavior · plugin enabled/disabled · same-JVM limitation testleri.

### Execution backend

| Trusted Local | Container |
|---|---|
| process cleanup | source read-only |
| path confinement | no network |
| environment allowlist | quota |
| | no host secret |
| | artifact export |
| | Paper isolation |
| | malicious fixture testleri |

### MCP

Tool list · stable ordering · input/output schema · `resultType` · structured content · domain error · protocol error · Resources · `stdio` lifecycle · **stdout purity** · Inspector · gerçek client.

### E2E

```text
project_inspect
-> source snapshot
-> plugin_build
-> operation_get
-> plugin_launch
-> ready gate
-> scenario_run
-> evidence_get
-> plugin_stop
-> runtime_release
-> GC validation
```

## Resilience testleri

Paper startup timeout · plugin enable crash · Bridge late load · port collision · disk full · wrong Java · artifact missing · artifact ambiguous · stop hangs · event overflow · evidence write fail · cleanup fail · container runtime unavailable · actor crash · MCP disconnect mid-mutation · unknown outcome recovery.

## Determinizm release gate

Her **zorunlu** scenario için:

| Ölçüt | Eşik |
|---|---|
| Fresh runtime (Linux) | 20 koşu |
| Fresh runtime (Windows profili) | 20 koşu |
| Bağımsız CI run | ≥ 2 |
| Failure oranı | **%0** |
| Cleanup failure | **%0** |
| Orphan | **%0** |

Beta sonrasında son 200 koşuda flaky rate `< %1`.

`%0` eşiği katıdır: bir scenario'nun 40 koşuda 1 kez patlaması, kullanıcı için "bazen yalan söyleyen bir doğrulama aracı" anlamına gelir; bu, aracın var oluş nedenini ortadan kaldırır.
