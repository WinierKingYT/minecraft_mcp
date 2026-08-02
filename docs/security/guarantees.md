# Güvenlik garantileri ve garanti edilmeyenler

Bu dosya DOC-GATE-06'nın normatif kaynağıdır. Buradaki her "sağlar" ifadesi bir teste, her "sağlamaz" ifadesi açık bir limitation cümlesine bağlıdır.

---

## Trusted Local backend

### Sağlar

| Garanti | Test |
|---|---|
| Canonical path confinement | `ST-PATH-001` |
| Environment allowlist | `ST-ENV-001` |
| Timeout (tüm child process tree'ye) | `ST-PROC-004` |
| Process ownership doğrulaması | `ST-PROC-003` |
| Ayrı geçici dizin ve ayrı Gradle user home | `ST-FS-002` |
| Output byte limiti | `ST-OUTPUT-001` |
| Audit kaydı | `IT-AUDIT-001` |
| Cleanup (process tree + port) | `ST-CLEANUP-001` |

### Sağlamaz

> Trusted Local, kötü niyetli Java veya Gradle koduna karşı **host izolasyonu sağlamaz.** Aynı kullanıcı yetkileriyle çalışan kodu tam olarak sınırlandıramaz.

> **Trusted Local hiçbir belgede, kod yorumunda, hata mesajında veya kullanıcı arayüzünde "sandbox" olarak adlandırılamaz.** Bu bir kelime tercihi değil, release gate'idir (KPI-11).

---

## Container backend

### Sağlamak zorunda olduğu kontroller

| Kontrol | Test |
|---|---|
| Source read-only mount | `ST-CONTAINER-FS-001` |
| Disposable writable filesystem | `ST-CONTAINER-FS-002` |
| Host secret erişimi yok | `ST-CONTAINER-SECRET-001` |
| Network policy (default deny) | `ST-CONTAINER-NET-001` |
| CPU/RAM/PID/disk quota | `ST-CONTAINER-QUOTA-001..004` |
| Paper ve Gradle'ın aynı izolasyon sınırında çalışması | `IT-BACKEND-PARITY-001` |
| Ayrı runtime identity | `ST-CONTAINER-ID-001` |
| Process tree cleanup | `ST-CLEANUP-002` |
| **No privileged container** | `ST-CONTAINER-PRIV-001` |
| **No Docker socket mount** | `ST-CONTAINER-SOCKET-001` |
| Read-only verified dependency cache | `ST-CONTAINER-CACHE-001` |
| Explicit artifact export | `IT-ARTIFACT-EXPORT-001` |

### Sağlamaz

> Container backend T3'e (host escape, kernel exploit) karşı garanti vermez.

---

## Backend eşleşme kuralı

```text
build_backend.security_level >= runtime_backend.security_level
```

Bir proje Container backend ile build edildiyse hedef artifact Trusted Local Paper üzerinde **çalıştırılamaz**. İhlal `BACKEND_SECURITY_DOWNGRADE` hatasıdır.

Test: `ST-BACKEND-DOWNGRADE-001`.

---

## Bridge authentication

### Sağlar

| Garanti | Test |
|---|---|
| Rastgele localhost process'lerinin bağlanamaması | `CT-BRIDGE-AUTH-001` |
| Tarayıcı / DNS rebinding girişimlerinin reddi | `CT-BRIDGE-AUTH-002` |
| Yanlış runtime'a bağlanmanın reddi | `CT-BRIDGE-004` |
| Kazara erişimin engellenmesi | `CT-BRIDGE-AUTH-003` |

### Sağlamaz

> Bridge auth, **aynı Paper JVM'i içinde çalışan aktif kötü niyetli hedef plugin'e karşı tam güvenlik sınırı değildir.**

Aynı JVM içindeki plugin şunları denemeyi başarabilir:

- environment değerlerini okumak,
- erişebildiği runtime dosyalarını okumak/değiştirmek,
- loopback endpoint'i kötüye kullanmak.

Bu nedenle:

1. T2 sınıfı projeler **Container içinde** çalıştırılmalıdır.
2. Kanıt bütünlüğü, saldırgan plugin'e karşı **mutlak garanti olarak sunulmamalıdır.**
3. Raporlarda bu limitation `known_limitations` alanı üzerinden taşınır.

Test: `ST-SAMEJVM-001`, `ST-SAMEJVM-002`.

---

## Agent yetkileri

| Kural | Durum |
|---|---|
| Agent-facing destructive tool | **V1'de yok** (`allow_agent_destructive_tools: false`, config'de sabit) |
| Agent'ın raw filesystem delete yetkisi | **Yok** — runtime silme yalnızca Garbage Collector |
| Agent'ın serbest Gradle task verme yetkisi | **Yok** — enum tabanlı build modu |
| Agent'ın serbest shell/RCON/konsol erişimi | **Yok** |
| Agent'ın mutlak path verme yetkisi | **Yok** — yalnızca `project_id` |
| Kimliğe sahip olmanın yetki anlamına gelmesi | **Hayır** — her çağrıda ownership yeniden doğrulanır |
