# Execution Backend ve izolasyon modeli

Karar kaydı: [`../adr/0004-execution-backends.md`](../adr/0004-execution-backends.md)

## Arayüz

```text
ExecutionBackend
├─ prepareSource(snapshot)
├─ prepareDependencyCache(profile)
├─ runBuild(buildPlan)
├─ launchPaper(runtimePlan)
├─ launchActor(actorPlan)
├─ collectArtifact(exportPlan)
├─ terminate(processHandle)
└─ destroyEnvironment(environmentHandle)
```

Bu arayüzün amacı, build ve runtime'ın **aynı** izolasyon soyutlaması üzerinden çalışmasını garanti etmektir. `launchPaper` bilinçli olarak backend arayüzünde yer alır: Paper'ı backend dışında başlatan bir kısayol, güven sınıfı eşleşme kuralını sessizce kırar.

## TrustedLocalBackend

Kontroller: canonical path · environment allowlist · ayrı HOME · ayrı Gradle user home · process group / Job Object · timeout · output limit · explicit network policy · no shell · audit.

> **Kısıt:** Host seviyesinde kötü niyetli kod izolasyonu sağlamaz. Bu backend **sandbox değildir** ve öyle adlandırılamaz.

## ContainerBackend

```yaml
container:
  privileged: false
  root_user: false
  docker_socket_mount: false
  source_mount: read_only
  workspace: disposable
  host_secrets: none
  network:
    default: none
    provisioning: repository_allowlist
  resources:
    cpu: "2"
    memory_mb: 4096
    pids: 256
    disk_mb: 8192
  dependency_cache:
    mount: read_only
    verified: true
```

## Güven sınıfı eşleşme kuralı

```text
runtime_backend.security_level >= build_backend.security_level
```

| Build | Runtime | Sonuç |
|---|---|---|
| `container` | `trusted-local` | **Reddedilir** — `BACKEND_SECURITY_DOWNGRADE` |
| `container` | `container` | İzin verilir |
| `trusted-local` | `trusted-local` | İzin verilir |
| `trusted-local` | `container` | İzin verilir (daha güçlü sınır zararsız) |

Gerekçe: Container'da build edilme kararı, kaynağın güvenilmez sayıldığı anlamına gelir. Aynı kaynaktan üretilen artifact'i daha zayıf bir sınırda çalıştırmak, izolasyon kararını anlamsız kılar. Tersi yönde bir kısıt yoktur: güvenilir bir kaynağı daha güçlü bir sınırda çalıştırmak hiçbir garantiyi zayıflatmaz.

Kural yönü ADR-0004 içinde düzeltilmiştir; kaynak belgedeki formül kendi açıklamasının tersiydi.

## Execution manifest

```json
{
  "execution_environment_id": "exe_...",
  "backend": "container",
  "backend_version": "1",
  "source_snapshot_id": "src_...",
  "network_profile": "offline",
  "resource_limits": {
    "cpu": 2,
    "memory_mb": 4096,
    "pids": 256,
    "disk_mb": 8192
  },
  "created_at": "..."
}
```

Bu manifest provenance zincirinin ikinci halkasıdır ve rapora dahil edilir.
