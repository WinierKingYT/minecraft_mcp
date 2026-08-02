# İzlenebilirlik matrisi

DOC-GATE-05 bu dosyayı denetler. V1'e giren her requirement aşağıdaki zincirin **her** halkasına sahip olmalıdır:

```text
JTBD -> Requirement -> ADR -> Capability -> Epic -> Acceptance Test -> Evidence -> Release Gate
```

Boş hücre CI hatasıdır. Capability ve test kimlikleri [`../packages/capability-registry/capabilities/`](../packages/capability-registry/capabilities/) kayıtlarından üretilir; bu tablo `pnpm run gen` tarafından yenilenir ve elle düzenlenmez.

<!-- BEGIN GENERATED: traceability -->
| Requirement | JTBD | ADR | Capability | Epic | Test | Evidence | Gate |
|---|---|---|---|---|---|---|---|
| REQ-001 Kayıtlı proje keşfi | JTBD-01 | ADR-0004 | `project.inspect` | E09 | CT-PROJECT-INSPECT-001 | `project-manifest` | M1 |
| REQ-002 Kaynak snapshot değişmezliği | JTBD-01, JTBD-04 | ADR-0004 | `project.validate` | E09 | ST-SNAPSHOT-001 | `source-snapshot` | M1 |
| REQ-003 Supply-chain doğrulaması | JTBD-01 | ADR-0004 | `build.run` | E10 | ST-GRADLE-001 | `build-log` | M1 |
| REQ-004 İzole build | JTBD-01 | ADR-0004 | `build.run` | E11, E12 | IT-BUILD-001 | `artifact-manifest` | M1 |
| REQ-005 Disposable Paper runtime | JTBD-02, JTBD-05 | ADR-0001, ADR-0003 | `runtime.lifecycle` | E13 | IT-RUNTIME-001 | `ready-gate-proof` | M1 |
| REQ-006 Bridge read-only gözlem | JTBD-02 | ADR-0001 | `world.block.read`, `events.read` | E07, E08 | CT-BRIDGE-001 | `event-log` | M0 |
| REQ-007 stdout saflığı | JTBD-04 | ADR-0002 | `system.health` | E05 | CT-MCP-STDOUT-001 | `mcp-transcript` | M0 |
| REQ-008 Deterministik scenario | JTBD-03 | ADR-0006 | `scenario.run` | E15, E16 | IT-SCENARIO-001 | `assertion-result` | M2A |
| REQ-009 Provenance zinciri | JTBD-04 | ADR-0003 | `evidence.read` | E14, E17 | IT-EVIDENCE-001 | `report-manifest` | M1 |
| REQ-010 Güvenli cleanup | JTBD-05 | ADR-0003 | `runtime.release` | E13, E19 | ST-CLEANUP-001 | `cleanup-result` | M1 |
| REQ-011 Gerçek player semantics | JTBD-03 | ADR-0006 | `test_actor.protocol` | E18 | IT-ACTOR-001 | `actor-transcript` | M2B* |
| REQ-012 Güvenlik dürüstlüğü | JTBD-04 | ADR-0007 | `system.capabilities` | E01 | DOC-GATE-06 | `doc-audit` | D0A |
| REQ-013 Stateless protokol yüzeyi | JTBD-04 | ADR-0008 | `system.capabilities` | E05 | CT-MCP-PROTOCOL-001 | `mcp-transcript` | M0 |
<!-- END GENERATED: traceability -->

\* M2B conditional — bkz. [`delivery/spikes/SPIKE-ACTOR-001.md`](delivery/spikes/SPIKE-ACTOR-001.md).

REQ-012 bir doküman gereksinimidir; capability sütunu `system.capabilities`'i gösterir çünkü limitation metinlerini ajana ulaştıran yüzey odur (`known_limitations` alanı). Kapı DOC-GATE-06 tarafından ayrıca denetlenir.
