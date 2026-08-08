# ADR-0004 — Execution backend soyutlaması ve güven sınıfı eşleşmesi

**Durum:** accepted
**Tarih:** 2026-07-29
**Bağlam:** REQ-003, REQ-004; [`../delivery/spikes/SPIKE-EXECUTION-CONTAINER-001.md`](../delivery/spikes/SPIKE-EXECUTION-CONTAINER-001.md)

## Bağlam

Ürün iki farklı kullanıcı gerçekliğiyle çalışmak zorunda:

- Geliştirici kendi makinesinde hızlı geri bildirim istiyor (T0).
- AI üretimli veya güvenilmez kod izolasyon istiyor (T1/T2).

Aynı zamanda hem **Gradle build'i** hem **Paper runtime'ı** güvenilmez kod çalıştırır: build script arbitrary Java, plugin de arbitrary Java. Bu ikisini farklı izolasyon sınırlarına koymak, izolasyon kararını anlamsız kılar.

## Karar

### 1. Tek `ExecutionBackend` arayüzü

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

`launchPaper` ve `launchActor` bilinçli olarak bu arayüzde yer alır. Paper'ı backend dışında başlatan bir kısayol, aşağıdaki kuralı sessizce kırar.

### 2. İki implementasyon

<!-- kpi-11-exempt: tablo, Trusted Local'ın sandbox OLMADIĞINI belirtmek için bu sütunu taşıyor -->

| Backend | Hedef sınıf | Sandbox mı? |
|---|---|---|
| `TrustedLocalBackend` | T0 | **Hayır** — bkz. ADR-0007 |
| `ContainerBackend` | T0, T1, T2 | Güçlü izolasyon hedefi (T3 hariç) |

### 3. Güven sınıfı eşleşme kuralı

```text
runtime_backend.security_level >= build_backend.security_level
```

Container'da build edilen artifact Trusted Local Paper üzerinde çalıştırılamaz. Tersi serbesttir: Trusted Local'de build edilmiş bir artifact Container içinde çalıştırılabilir. İhlal `BACKEND_SECURITY_DOWNGRADE`.

> **Düzeltme kaydı (2026-07-30).** V3 sözleşme belgesi bu kuralı `build_backend.security_level >= runtime_backend.security_level` biçiminde yazıyordu. Bu, belgenin kendi düzyazı açıklamasının **tersidir**: container (2) ≥ local (1) doğru olduğundan, formül tam da yasaklanmak istenen "container build + local runtime" birleşimini serbest bırakırdı. Hata `ST-BACKEND-DOWNGRADE-001` kabul testi yazılırken yakalandı ve yön düzeltildi.

### 4. Container zorunlu kontroller

Read-only source mount · disposable writable fs · host secret yok · network default deny · CPU/RAM/PID/disk quota · ayrı runtime identity · process tree cleanup · **no privileged container** · **no Docker socket mount** · read-only verified dependency cache · explicit artifact export.

Canlı deney bulguları (SPIKE-EXECUTION-CONTAINER-001, closed) bu listenin
**uygulama detaylarını** belirler:

- Build **copy-in** modelidir: ro kaynak `/output` içinde disposable kopyaya
  kopyalanır (Gradle 9 proje-içi `.gradle/` + `build/reports/problems`
  yazımları ro kaynakta imkânsızdır).
- Verified dependency cache doğrudan ro mount edilmez; wrapper `.lck`/`.ok`
  yazımı yüzünden **tar seed** ile disposable alana kopyalanır.
- Bellek limiti **swap kapalı** varsayılanla serttir (`--memory-swap` =
  `--memory`; opsiyonel `maxSwapMb` ile açılır).
- Paper runtime'ı için **seed fazı** vardır: Paperclip indirmesi ve world gen,
  network'li kısa ömürlü seed container'ında tamamlanır (`Done (` poll);
  asıl runtime container `--network none` + hazır world ile başlar.
- Timeout sonrası container `docker rm -f` ile silinir (CLI kill orphan
  bırakır).
- Bridge yönetilen runtime tespiti ister (`-Dmcpdev.runtime.root`,
  `-Dmcpdev.server.instance.id`, `.mcpdev-runtime` marker, `bridge-token`);
  bunlar dışında HTTP yüzeyi açılmaz.

### 5. Provisioning modu Container zorunludur

Ağ erişimi gerektiren tek mod olan `provisioning`, kullanıcı onayı ve Container backend olmadan çalışmaz.

## Alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| Yalnızca Trusted Local | T1/T2 için hiçbir iddia yapılamaz; ürünün ana kullanım senaryosu (AI üretimli kod) korumasız kalır |
| Yalnızca Container | Docker gerektirmek yerel geliştirme ergonomisini ve KPI-01'i (temiz makinede kurulum) ciddi biçimde zorlaştırır |
| Build'i Container'da, Paper'ı local'de çalıştırmak | İzolasyon kararını anlamsız kılar: güvenilmez sayılan kaynaktan üretilen plugin host'ta çalışır |
| Backend'i her operation için ayrı seçilebilir yapmak | Aynı run içinde farklı güven sınıfları karışır; provenance zinciri yorumlanamaz hâle gelir |
| VM tabanlı izolasyon | V1 için maliyet ve kurulum yükü çok yüksek; T3 hedeflenmiyor |

## Sonuçlar

**Olumlu**

- İzolasyon kararı tek bir yerde ve tüm yürütme yüzeyi için tutarlı.
- `execution_environment_id` provenance zincirinin ikinci halkası olarak raporlanabilir.
- Container yoksa ürün yine çalışır, fakat T1/T2 iddiası yapmaz.

**Olumsuz**

- `launchPaper`'ın backend arayüzünde olması, Paper başlatma kodunu iki implementasyonda ayrı tutmayı gerektirir.
- Container'da Paper başlatmak, seed fazı (network'li hazırlık) ve loopback Bridge erişimi (supervisor erişim katmanı) gerektirir — `SPIKE-EXECUTION-CONTAINER-001` (closed) bunları doğruladı; Bridge'e host erişimi M2B'de tasarlanır.
- Eşleşme kuralı bazı kullanıcı akışlarını reddeder ve iyi bir hata mesajı gerektirir.

**Kanıt:** `ST-BACKEND-DOWNGRADE-001`, `ST-CONTAINER-*`, `IT-BACKEND-PARITY-001`.

## İlgili

- [`../architecture/execution-backends.md`](../architecture/execution-backends.md)
- [`../security/guarantees.md`](../security/guarantees.md)
- [ADR-0007](0007-security-claims.md)
