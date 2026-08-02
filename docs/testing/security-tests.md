# Güvenlik test listesi

Her madde negatif testtir: beklenen sonuç **açık hata kodu ve güvenli durum**, "çökmedi" değil.

## Path ve dosya sistemi

| Test | Beklenen |
|---|---|
| `ST-PATH-001` `../` traversal | `PATH_OUTSIDE_ROOT` |
| `ST-PATH-002` Mutlak path tool input | Şema reddi |
| `ST-PATH-003` Symlink | `SYMLINK_NOT_ALLOWED` |
| `ST-PATH-004` Junction / reparse point (Windows) | `SYMLINK_NOT_ALLOWED` |
| `ST-ARCHIVE-001` Archive traversal | `ARCHIVE_ENTRY_OUTSIDE_ROOT` |
| `ST-ARCHIVE-002` Zip bomb | `ARCHIVE_EXPANSION_LIMIT` |
| `ST-FS-002` Ayrı HOME / Gradle user home | Host HOME'a yazma yok |
| `ST-OUTPUT-001` Output byte limiti | `OUTPUT_LIMIT_EXCEEDED` |

## Process

| Test | Beklenen |
|---|---|
| `ST-PROC-001` Shell metacharacter | Argüman olarak geçer, yorumlanmaz |
| `ST-PROC-002` Gradle arg injection | Task allowlist reddi |
| `ST-PROC-003` Bilinmeyen PID | Öldürülmez; `PROCESS_OWNERSHIP_MISMATCH` |
| `ST-PROC-004` Timeout child tree'ye | Tüm ağaç sonlanır |
| `ST-ENV-001` Dangerous environment | Allowlist dışı değişken geçmez |
| `ST-CLEANUP-001` Trusted Local cleanup | Process + port serbest |
| `ST-CLEANUP-002` Container process tree cleanup | Orphan yok |
| `ST-CLEANUP-003` Force termination | Ayrı durum + audit event |
| `ST-RECOVERY-001` MCP crash → Supervisor recovery | Ownership korunur |

## Supply chain

| Test | Beklenen |
|---|---|
| `ST-GRADLE-001` Malicious wrapper JAR | `GRADLE_WRAPPER_JAR_UNVERIFIED` |
| `ST-GRADLE-002` Invalid distribution checksum | `GRADLE_DISTRIBUTION_CHECKSUM_INVALID` |
| `ST-GRADLE-003` Unapproved distribution URL | `GRADLE_DISTRIBUTION_URL_UNAPPROVED` |
| `ST-GRADLE-004` Missing checksum | `GRADLE_DISTRIBUTION_CHECKSUM_MISSING` |
| `ST-GRADLE-005` Dependency verification failure | `DEPENDENCY_VERIFICATION_FAILED` |
| `ST-GRADLE-006` Dynamic dependency | `DYNAMIC_DEPENDENCY_FORBIDDEN` |
| `ST-GRADLE-007` Unapproved repository | `UNAPPROVED_REPOSITORY` |

## Container izolasyonu

| Test | Beklenen |
|---|---|
| `ST-CONTAINER-FS-001` Source read-only | Yazma denemesi başarısız |
| `ST-CONTAINER-FS-002` Disposable workspace | Konteyner sonrası iz kalmaz |
| `ST-CONTAINER-NET-001` No network | Egress başarısız, kayıt altında |
| `ST-CONTAINER-SECRET-001` Host secret erişimi | Erişim yok |
| `ST-CONTAINER-QUOTA-001..004` CPU/RAM/PID/disk | Limit uygulanır |
| `ST-CONTAINER-PRIV-001` Privileged container | **Asla oluşturulmaz** |
| `ST-CONTAINER-SOCKET-001` Docker socket mount | **Asla mount edilmez** |
| `ST-CONTAINER-CACHE-001` Read-only verified cache | Yazma denemesi başarısız |
| `ST-BACKEND-DOWNGRADE-001` Container build → local runtime | `BACKEND_SECURITY_DOWNGRADE` |

## Bridge ve protokol

| Test | Beklenen |
|---|---|
| `CT-BRIDGE-AUTH-001` Yanlış token | 401, sabit süreli karşılaştırma |
| `CT-BRIDGE-AUTH-002` Origin/Host manipülasyonu | 403 |
| `CT-BRIDGE-AUTH-003` Süresi geçmiş token | `HANDLE_EXPIRED` |
| `CT-BRIDGE-004` Yanlış run handle / instance | `EVENT_CURSOR_INSTANCE_MISMATCH` / 409 |
| `CT-BRIDGE-005` Body / queue / rate limit | `BRIDGE_BUSY`, `BODY_TOO_LARGE` |
| `CT-IDEMPOTENCY-001` Aynı key + aynı argüman | Aynı sonuç |
| `CT-IDEMPOTENCY-002` Aynı key + farklı argüman | `IDEMPOTENCY_KEY_ARGUMENT_MISMATCH` |
| `CT-IDEMPOTENCY-003` Runtime down mutation | `RUNTIME_NOT_RUNNING` |

## Same-JVM (kabul edilen limitation)

| Test | Beklenen |
|---|---|
| `ST-SAMEJVM-001` Hedef plugin token/env okuma denemesi | **Başarılı olabilir** — test bunu belgeler, engellemez |
| `ST-SAMEJVM-002` Hedef plugin evidence değiştirme denemesi | Checksum uyuşmazlığı tespit edilir |

Bu iki test "geçmesi gereken" testler değildir; **limitation'ın hâlâ doğru belgelendiğini** doğrulayan testlerdir. Davranış değişirse belge güncellenmelidir.

## Veri sızıntısı

| Test | Beklenen |
|---|---|
| `ST-REDACT-001` Secret log'a yazılmaz | Maskelenir |
| `ST-REDACT-002` Absolute host path raporda yok | Yok |
| `ST-REDACT-003` IP / chat / kişisel veri | Kaydedilmez |
| `ST-INJECT-001` Malicious player text | Veri olarak işlenir, şablon olarak yorumlanmaz |
| `ST-SNAPSHOT-001` Build sırasında kaynak değişimi | `SOURCE_CHANGED_DURING_BUILD` |
