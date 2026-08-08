# SPIKE-EXECUTION-CONTAINER-001 — Container execution backend

**Durum:** closed
**Blokladığı:** ADR-0004, M1
**Zaman kutusu:** 3–4 gün

## Cevaplanacak sorular

1. Windows üzerinde Docker (WSL2 backend) ile read-only bind mount, quota ve PID limiti güvenilir biçimde uygulanabiliyor mu?
2. Paper **ve** Gradle aynı konteyner sınırında çalışabilir mi, yoksa iki ayrı konteyner mi gerekiyor? İkisi ayrıysa güven sınıfı eşleşme kuralı nasıl korunur?
3. `--network=none` altında Gradle `--offline` build tam olarak çalışıyor mu (toolchain provisioning dahil)?
4. Read-only dependency cache mount'u Gradle tarafından kabul ediliyor mu, yoksa cache'e yazma denemesi build'i kırıyor mu?
5. Artifact export'u host'a nasıl yapılır (explicit copy) ve export sırasında path traversal mümkün mü?
6. Konteyner içinden host secret'larına (env, mounted config, credential helper) erişim gerçekten kapalı mı?
7. Process tree cleanup: konteyner öldüğünde içindeki Paper JVM ve Gradle daemon kesin olarak ölüyor mu?
8. Gradle daemon konteyner ömründen uzun yaşayabiliyor mu? Daemon devre dışı bırakılmalı mı?
9. Container runtime yoksa (kurulu değil / servis kapalı) hata mesajı ne kadar teşhis edilebilir?
10. Kaynak limitleri (2 CPU / 4 GB) gerçek bir Paper + Gradle build için yeterli mi?

## Deney planı

1. Minimal bir Paper plugin projesi ile `reproducible` modda konteyner build'i.
2. Aynı konteynerde Paper başlatma ve ready gate.
3. Kötü niyetli fixture: dosya yazma, ağ çağrısı, env okuma, `/var/run/docker.sock` arama denemeleri.
4. Quota testleri: bellek balonu, PID bombası, disk doldurma.
5. 20 kez lifecycle döngüsü; orphan process ve disk artığı sayımı.

## Çıkış kararı

| Sonuç | Karar |
|---|---|
| Tüm kontroller uygulanabiliyor | Container backend M1'de zorunlu default |
| Windows'ta kısmen uygulanabiliyor | Container Linux'ta default, Windows'ta opt-in; kısıt belgelenir |
| Paper ve Gradle ayrı konteyner gerektiriyor | İki konteyner + tek `execution_environment_id`; eşleşme kuralı korunur |
| Uygulanamıyor | ADR-0004 revize; V1 yalnızca Trusted Local ile çıkar ve **T2 desteklenmediği açıkça yazılır** |

Son satır kritiktir: Container backend olmadan T2 sınıfı için hiçbir iddia yapılamaz.

## Bulgular

### Kod tarafı (Docker kurulmadan doğrulanan — `container-backend.ts`)

`buildDockerRunArgs` ile ADR-0004 §4 kontrolleri tek yerde toplandı ve gerçek
davranış olarak test edildi (`container-security.test.ts` → 470 test, 0 fail):

| Q | Bulgu | Kod |
|---|---|---|
| Q1 | `--cap-drop ALL` + `--security-opt no-new-privileges` + `--pids-limit 512` + `--memory`/`--cpus` + tmpfs disk limiti uygulanıyor; bellek limiti swap kapalı varsayılanla sert (canlı: OOM rc=137) | `buildDockerRunArgs` (container-backend.ts:150) |
| Q2 | Build (`mcpdev-build-*`) ve runtime (`mcpdev-runtime-*`) ayrı kimlik prefix'leri; port yayınlama YALNIZCA explicit `publishPorts` ile açılıyor (default kapalı); güven sınıfı eşleşmesi `assertBackendPairing` ile (backend.ts:72). Paper ve Gradle AYNI konteyner sınırında çalışabilir (canlı: Paper Done 12.9s) — ayrı konteyner gerekmez | `namePrefix`, `publishPorts` |
| Q3 | `network: 'offline'` → komuta `--offline` eklenir; `--network none` zaten default. Canlı: copy-in + ro cache ile offline build TAMAM (toolchain provisioning dahil) | `ContainerBuildEnvironment.build` |
| Q4 | Read-only cache mount doğrudan kabul edilmez (wrapper `.lck`/`.ok` yazar); copy-in modeli cache'i tar ile `/output/.gradle`'a seed'ler (canlı: success). Doğrudan ro GRADLE_USER_HOME KULLANILMAZ | `build()` |
| Q5 | `assertInsideDir` + `ContainerPathTraversalError` — `..` kaçışı ve dış absolute yol reddedilir; `collectArtifact` containment'ı doğrular (ST-CONTAINER-EXPORT-001) | `assertInsideDir` |
| Q6 | Env yalnızca explicit allowlist'ten gelir (host env asla karışmaz); mount yalnızca explicit listeden; docker.sock hiçbir argümanda yok (canlı: env/socket/network hepsi blocked) | `buildDockerRunArgs` |
| Q7/Q8 | `--rm` + `--init` (zombie reaper); timeout sonrası `docker rm -f` (canlı bulgu — CLI kill orphan bırakıyor); Gradle daemon default `--no-daemon`; `cleanup()` `mcpdev-*` prefix'li exited konteynerleri toplar (canlı: 20/20 + orphan yok) | `run()`, `cleanup()` |
| Q9 | `getAvailability()`: `docker-not-found` / `daemon-unavailable` / `ok` ayrımı + teşhis detayı (ST-CONTAINER-DIAG-001, execImpl mock ile 3 senaryo) | `getAvailability` |
| Q10 | Default: 2 CPU / 4096 MB. Canlı: Paper + Bridge + seed, 2 CPU limiti altında 12.9s'de `Done` — yeterli | `ContainerBackendOptions` |

### Ek bulgular (canlı deney sonrası)

- Runtime hazırlama (seed) modeli: network'li seed container → `Done (` poll →
  runtime container (`--network none`, hazır world). ADR-0004'e "runtime seed
  fazı" olarak eklenir (bkz. Sonuç).
- Fixture'lara wrapper (gradlew + jar + doğrulanmış properties) ve toolchain 25
  eklendi (profil `paper-26.2-build-84-v1` ile hizalı).

### Canlı deney (Docker Desktop + WSL2 backend, Windows 11)

`apps/run-supervisor/src/spike-container-check.ts` ile koşuldu (5 koşu;
koşu 5'te tüm deneyler beklenen sonucu verdi).

| # | Deney | Sonuç | Detay |
|---|---|---|---|
| 1a | `exp1_offline_without_cache` | blocked (beklenen) | cache yokken offline build toolchain/dependency sağlayamaz (exit 1) |
| 1b | `exp1_offline_with_ro_cache` | **success** | ro cache mount + `--offline` + copy-in ile offline build tamamlandı |
| 2 | `exp2_paper_ready` | **success** | Paper + Bridge container'da ayağa kalktı (`Done (12.9s)`), handshake yazıldı (port=44575), 300s deadline'da ayakta; timeout sonrası container temizlendi |
| 2b | `exp2_host_loopback_access` | blocked (beklenen) | Bridge 127.0.0.1 bind ettiği için docker publish ile host'tan erişilemez — supervisor erişim katmanı (docker exec / bind ayrımı) gerekir |
| 3a | `exp3_env_leak` | blocked | host env değişkenleri container içine sızmadı |
| 3b | `exp3_docker_socket` | blocked | docker.sock container içinde yok |
| 3c | `exp3_network` | blocked | `--network none` ağı kesti |
| 3d | `exp3_ro_workspace` | blocked | ro mount yazmayı engelledi |
| 3e | `exp3_tmpfs_writable` | expected | tmpfs yazılabilir (disposable writable fs) |
| 4a | `exp4_disk_quota` | blocked | tmpfs 100MB limiti disk doldurmayı engelledi |
| 4b | `exp4_pid_quota` | blocked | `--pids-limit 512` process bombasını engelledi (exit 2) |
| 4c | `exp4_mem_quota` | blocked | 256MB limit + swap kapalı: 300MB anonim bellek OOM ile öldürüldü (rc=137) |
| 5a | `exp5_lifecycle` | success | 20/20 container lifecycle tamamlandı |
| 5b | `exp5_orphans` | success | `--rm` + `--init` + timeout-sonrası `rm -f` ile orphan container yok |

#### Canlı deney bulguları (kod değişikliklerini yönlendirdi)

1. **Copy-in build modeli zorunlu** — Gradle 9 kaynağa ro mount edilse bile
   proje-içi `.gradle/9.6.1/fileHashes/fileHashes.lock` ve session başında
   `build/reports/problems` dizinine yazar; init-script redirect bu yazımı
   kurtarmaz. Build, kaynağı `/output/src` içine kopyalayıp orada koşar
   (`cp -a /src/. /output/src/` → `exec <komut>`). Kaynak mount ro kalır.
2. **ro GRADLE_USER_HOME kullanılamaz** — Gradle wrapper, dağıtım dizinine
   `.lck`/`.ok` dosyaları yazar. Cache `/cache:ro`'dan `/output/.gradle`'a
   tar seed'lenir (`--exclude=*.lock --exclude=*.lck --exclude=*.tmp`);
   `cp -a` doğrudan kopyada kilitli dosyalarda 9p I/O error üretir.
3. **Bellek limiti yalnızca swap kapalıyken serttir** — Docker default
   `--memory-swap` = 2× `--memory` yumuşak limit verir (300MB tahsis başarılı).
   `--memory-swap` = `--memory` → OOM kill rc=137 (kanıtlandı). Backend
   varsayılanı swap kapalıdır; `maxSwapMb` ile açılabilir.
4. **Timeout orphan yaratır** — `docker run` CLI'ı timeout'ta öldürülünce
   container ayakta kalır (`--rm` temizliği CLI tarafındadır). Backend timeout
   sonrası `docker rm -f` çağırır (kanıt: koşu 3'te kalan
   `mcpdev-runtime-*` orphan'ı, koşu 5'te yok).
5. **Paper ilk açılışı ağ gerektirir** — Paperclip `mojang_26.2.jar`'ı
   çalışma zamanında indirir. Model: network'li **seed container**'ı world
   gen'i tamamlar (`Done (` log'unda görülene kadar beklenir), sonra
   `--network none`'lu runtime container'ı hazır world ile başlar. Network'süz
   Paper'ın açılması **engellenmez** (Done 12.9s'de gelir); yalnızca version
   fetcher arka planda hata döner (zararsız noise).
6. **Bridge yönetilen runtime tespiti** — Bridge HTTP sunucusu yalnızca
   `-Dmcpdev.runtime.root` + `-Dmcpdev.server.instance.id` JVM property'leri,
   `.mcpdev-runtime` marker dosyası ve `bridge-token` dosyası varsa açılır
   (bilinçli güvenlik davranışı — yanlışlıkla atılan JAR kontrol yüzeyi
   açmaz). Spike'ın 4 koşusunda handshake bulunamamasının gerçek nedeni
   buydu; koşu 5'te runtime bağlamı enjekte edildi ve handshake yazıldı.
7. **Runtime dizini rw, build kaynağı ro** — Paper state'i (world, logs,
   cache) runtime dizinine yazar; ro mount çalışma zamanında kırılır.
   İkisi farklı mount'tur; aynı konteyner sınırında birlikte çalışır
   (ayrı konteyner GEREKMEZ).
8. **Bridge loopback bind** — `127.0.0.1` bind eden Bridge portu publish
   edilemez; host tarafı erişimi için supervisor katmanı (ör. docker exec
   içi localhost proxy veya bind ayrımı) M2B'de tasarlanacak.

## Sonuç

**Container backend M1'de zorunlu default olarak kalır; Paper ve Gradle aynı
konteyner sınırında çalışabilir — ayrı konteyner gerekmez.** Tüm kontroller
Windows (WSL2 backend) üzerinde canlı olarak doğrulandı: offline build (copy-in
+ ro cache seed), Paper + Bridge runtime (seed fazı + `--network none`),
resource quota'ları (disk/PID/bellek), orphan temizliği (timeout sonrası
`rm -f`) ve secret izolasyonu. ADR-0004 revizyonu gerekmez; ürüne şu
bulgular işlenmiştir:

- Build copy-in modelidir (ro source + `/output` içinde disposable kopya).
- Cache, ro mount değil tar seed ile verilir (wrapper `.lck` yazımı).
- Bellek limiti swap kapalı varsayılanla serttir (`maxSwapMb` ile açılır).
- Runtime hazırlığı (Paperclip indirmesi + world gen) network'li seed
  container'ı ile yapılır; runtime container `--network none` koşar.
- Timeout sonrası container `docker rm -f` ile silinir (orphan önleme).
- Bridge yönetilen runtime tespitini ister (`-Dmcpdev.runtime.root`,
  `-Dmcpdev.server.instance.id`, `.mcpdev-runtime`, `bridge-token`);
  bunlar dışında HTTP yüzeyi açılmaz.
- Host'tan Bridge'e erişim, loopback bind nedeniyle supervisor erişim
  katmanı gerektirir (M2B'de tasarlanır).

Çıkış kararı tablosundan **ilk satır** geçerlidir. Süreç: ADR-0004 kod tarafı
zorunlulukları + canlı deney bulguları → D0C Architecture Freeze.
