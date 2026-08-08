# Feasibility spikes (D0B)

Her spike'ın **açık bir çıkış kararı** olmalıdır. "Araştırdık, ilginçti" bir spike sonucu değildir.

| Spike | Konu | Blokladığı | Durum |
|---|---|---|---|
| [`SPIKE-EXECUTION-CONTAINER-001`](SPIKE-EXECUTION-CONTAINER-001.md) | Container backend | ADR-0004, M1 | `closed` |
| [`SPIKE-WINDOWS-PROCESS-001`](SPIKE-WINDOWS-PROCESS-001.md) | Windows process tree cleanup | M1, KPI-06 | `closed` |
| [`SPIKE-ACTOR-001`](SPIKE-ACTOR-001.md) | Protocol test actor | ADR-0006, M2B | `closed` |
| [`SPIKE-MCP-SDK-2026-001`](SPIKE-MCP-SDK-2026-001.md) | MCP 2026 SDK / protokol | ADR-0002, V1 | `closed` |
| [`SPIKE-PAPER-DOWNLOAD-001`](SPIKE-PAPER-DOWNLOAD-001.md) | Paper Downloads Service + checksum | Compatibility profile, M1 | `closed` |
| [`SPIKE-SAME-JVM-THREAT-001`](SPIKE-SAME-JVM-THREAT-001.md) | Same-JVM tehdit sınırı | ADR-0007 | `open` |

## Spike şablonu

```markdown
# <SPIKE-ID> — <Başlık>

**Durum:** open | done | abandoned
**Blokladığı:** <ADR / milestone / KPI>
**Zaman kutusu:** <gün>

## Cevaplanacak sorular
1. ...

## Deney planı
...

## Çıkış kararı
| Sonuç | Karar |
|---|---|
| ... | ... |

## Bulgular
_(spike sırasında doldurulur)_

## Sonuç
_(bir cümlelik karar + hangi ADR'a bağlandığı)_
```
