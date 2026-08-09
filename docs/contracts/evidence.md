# Evidence Store ve provenance zinciri

## Kimlik ayrımı

`source_snapshot_id` · `build_artifact_id` · `runtime_image_id` · `scenario_run_id` · `evidence_id` · `report_id` · `log_stream_id`

## Provenance zinciri

```text
source_snapshot_id
  -> execution_environment_id
    -> build_artifact_id
      -> runtime_image_id
        -> server_instance_id
          -> scenario_run_id
            -> evidence_id[]
              -> report_id
```

**Karar:** Zincirin herhangi bir halkasının eksik olması release gate hatasıdır (KPI-09). Bir rapor, hangi kaynak durumundan hangi artifact üzerinden hangi runtime'da üretildiğini kanıtlayamıyorsa kanıt değildir.

## Evidence manifest

```yaml
evidence_id: ev_...
run_id: run_...
scenario_run_id: scn_...
kind: event-log

producer:
  component: paper-bridge
  version: 0.1.0
  server_instance_id: srv_...
  bridge_boot_id: boot_...

integrity:
  sha256: "sha256:..."
  byte_size: 4821

range:
  sequence_from: 1040
  sequence_to: 1088

redaction:
  profile: default-v1
  removed_fields:
    - player.ip
    - authorization

retention:
  created_at: "..."
  expires_at: "..."
```

`producer` alanı zorunludur: aynı `kind` altındaki bir evidence'ın Bridge tarafından mı Supervisor tarafından mı üretildiği, same-JVM limitation'ı değerlendirmek için gereklidir.

## Report manifest

```json
{
  "report_id": "rep_...",
  "run_id": "run_...",
  "source_snapshot_id": "src_...",
  "build_artifact_id": "bart_...",
  "runtime_image_id": "rimg_...",
  "scenario_run_id": "scn_...",
  "compatibility_profile": "paper-26.2-build-84-v1",
  "fixture_id": "flat-world-v1",
  "result": "FAILED",
  "cleanup": "PASSED",
  "evidence_ids": ["ev_1", "ev_2", "ev_3"]
}
```

**Karar (KPI-12):** `result` ve `cleanup` **ayrı** alanlardır. Cleanup failure ana test sonucunu gizlemez ve ana test başarısı cleanup failure'ı gizlemez.

## Storage

V1:

- SQLite metadata
- Content-addressed file store
- Atomic temp-write + rename
- Checksums
- Quota
- Retention
- Orphan evidence cleanup
- **No raw secret**
- **No absolute host path in public report**

Rapor formatları: JSON · Markdown · JUnit XML. Üçü aynı `report_id`'yi ve aynı provenance alanlarını taşır.

**Uygulama:** `apps/run-supervisor/src/scenario-report.ts` (DSL-12 sonrası). JSON şeması `scenario-report-v1`; JUnit XML testcase başına scenario, `failure type="failed|timed_out"`; kamuya açık raporda mutlak host path reddedilir (`SCENARIO_REPORT_PATH_ABSOLUTE`) ve ayraçlar Unix formuna normalize edilir. Dosyalar atomik yazılır (temp-write + rename). Canlı kanıt: `docs/operations/m2a-demo.md` (`rep_c467f99202f86d214363f7c0`).

**Provenance uygulaması:** `scenario-evidence.ts` collector'ı her scenario run için run-level + assertion-level evidence yazar; manifest producer'ı `serverInstanceId` (runtime_image_id) ve `bridgeBootId` taşır (engine `setRuntimeInfo` ile bağlar). Demo `.mcpdev-data/evidence/<runId>/` altında content-addressed store yapılandırır ve koşum sonunda `evidence.get` ile checksum yeniden doğrulaması yapar. Canlı kanıt: 6 scenario, 11 kanıt (`docs/operations/m2a-demo.md`).
