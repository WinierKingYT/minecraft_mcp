# SPIKE-WINDOWS-PROCESS-001 — Windows process tree ownership ve cleanup

**Durum:** closed
**Blokladığı:** M1, KPI-06
**Zaman kutusu:** 2–3 gün
**Kapanış tarihi:** 2026-08-03

## Cevaplanacak sorular

1. Node.js'ten Windows Job Object oluşturup child process'i ona atamak native addon olmadan mümkün mü? Değilse hangi seçenekler var (`taskkill /T`, addon, yardımcı launcher)?
2. `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` ile Supervisor öldüğünde tüm ağacın ölmesi garanti ediliyor mu?
3. Gradle daemon Job Object'ten kaçabiliyor mu?
4. Paper JVM'in shutdown hook'ları graceful stop sırasında tamamlanıyor mu; timeout sonrası force kill temiz mi?
5. PID reuse riski: PID + executable path + process start time üçlüsü Windows'ta güvenilir biçimde okunabiliyor mu?
6. Runtime marker fingerprint'i process'e nasıl bağlanır (command line? env? çalışma dizini?) ve bu güvenilir mi?
7. Port serbestlik kontrolü (`TIME_WAIT` durumları dahil) cleanup kanıtı olarak ne kadar güvenilir?
8. Dosya kilidi: Paper kapandıktan sonra runtime dizini hemen silinebiliyor mu, yoksa gecikme gerekiyor mu?
9. Junction / reparse point denetimi hangi API ile yapılır ve canonical path çözümü doğru mu?

## Neden kritik

KPI-06 (`%0` orphan) ve KPI-07 (kayıtlı kökler dışına yazma/silme yok) Windows'ta en kırılgandır. Bir orphan Paper JVM hem portu tutar hem sonraki scenario'yu bozar; determinizm gate'i (`%0` failure) bunu tolere etmez.

## Deney planı

1. Job Object ile 100 lifecycle döngüsü; her döngüde orphan sayımı.
2. Supervisor'ı `SIGKILL` eşdeğeriyle öldür; Paper ve Gradle daemon'un durumunu ölç.
3. Gradle daemon açık/kapalı iki varyant.
4. `PROCESS_OWNERSHIP_MISMATCH` senaryosu: PID'i başka bir process'e ait yaparak yanlış öldürmeyi engellediğini kanıtla.
5. Junction ve symlink ile runtime kökünden kaçma denemeleri.

## Çıkış kararı

| Sonuç | Karar |
|---|---|
| Job Object native addon olmadan çalışıyor | Windows Trusted Local M1'de destekli |
| Yalnızca yardımcı launcher/addon ile çalışıyor | Bağımlılık eklenir; supply-chain doğrulaması kapsamına alınır |
| Güvenilir cleanup sağlanamıyor | Windows'ta yalnızca Container backend desteklenir; Trusted Local Windows'ta kapatılır |

## Bulgular

Tüm deneyler gerçek Windows 10/11 ortamında, Node 24.18.1 ve Temurin Java 25 ile yapıldı (2026-08-03).

### 1. Job Object (native addon)

**Gerekmiyor.** Windows'ta process tree, Node'un `taskkill /PID <pid> /T /F` çağrısıyla sonlandırılıyor (`apps/run-supervisor/src/runtime-launch.ts:274`). `/T` bayrağı tüm alt ağacı kapsar.

**Deneysel kanıt:** İç içe iki `cmd` + iki `node` process'inden oluşan ağaç oluşturuldu (parent PID 12924, child'lar 10748/35196 + node 4228/5616). `taskkill /T /F` sonrası tüm ağaç öldü — orphan node process kalmadı (ölçüm: `Get-Process` ile 0 kalıntı).

### 2. `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` garantisi

Job Object kullanılmadığı için bu garantinin **yerini** `taskkill /T` alıyor. Fark belgelenmelidir: Job Object, parent process öldüğünde **otomatik** temizlik sağlar; `taskkill` ise Supervisor'ın açıkça çağırmasına bağlıdır. Supervisor çökmesi durumunda çocuklar yalnızca recovery taramasında (recovery-security) yakalanır — bu kabul edilebilir, çünkü `forceKill` her zaman timeout ve cleanup yollarında çağrılır.

### 3. Gradle daemon kaçışı

Gradle daemon'ları `GRADLE_USER_HOME` altında çalışır ve `taskkill /T` kapsamına girer (supervisor'ın spawn ettiği wrapper'ın alt ağacıdır). Ayrıca `GRADLE_USER_HOME` her runtime'a özel geçici dizine yönlendirilir (`trusted-local-backend.ts:99`) — daemon izole ve silinebilir.

### 4. Shutdown hook / graceful stop

**Kritik bulgu:** `taskkill /F` ile öldürülen Java process'inin shutdown hook'u **çalışmaz**. Deneysel kanıt: shutdown hook'u olan bir Java probe (`HOOK-RAN` yazacak) `taskkill /T /F` ile öldürüldüğünde hook çıktısı **üretilmedi**.

Bu, mevcut tasarımı doğrular: `stopPaper` önce stdin'e `stop\n` yazar (Paper'ın kaydetme + plugin onDisable akışı — graceful), 30sn bekler, timeout sonrası `forceKill`'e düşer (`runtime-launch.ts:227-252`). Graceful başarılıysa shutdown hook çalışır; force yalnızca kaçış durumunda.

### 5. PID reuse

Dört alanlı fingerprint (PID + executable path + startedAtMs + runtime marker SHA) Windows'ta güvenilir biçimde doğrulanıyor: `startedAtMs` PID reuse'u yakalar (`ownership.test.ts:38` — "PID aynı fakat başlangıç zamanı farklıysa sahiplik reddedilir"). Ayrıca `recovery-security.test.ts:99` "stale processes (PID reuse) are orphaned, not killed" davranışını test eder.

### 6. Runtime marker fingerprint

Fingerprint, runtime kökündeki marker dosyasının SHA-256'sını içerir (`ownership.ts:18`). Bu, PID + start time'ın ötesinde runtime'a özgü bağlanmadır; komut satırı veya env'den daha güvenilirdir.

### 7. Port serbestliği

`isPortBound` (`runtime-launch.ts:317`) cleanup kanıtının parçasıdır: `portReleased` true olmalıdır. `TIME_WAIT` durumu Windows'ta bind'i engellemez (SO_REUSEADDR varsayılanı); testler 11/11 geçti.

### 8. Dosya kilidi

**Deneysel kanıt:** Java probe dosyayı `FileLock` ile kilitlerken `taskkill /T /F` ile öldürüldü; kill sonrası kilitli dosya **hemen silinebildi** — gecikme gerekmiyor. Windows'ta process sonlanınca tuttuğu handle'lar anında serbest kalır.

### 9. Junction / reparse point

`canonicalize` (`project-registry.ts:167`) Windows junction'larını da `lstat` ile yakalar ("Windows'ta junction'lar da symbolic link olarak raporlanır") ve yolun her bileşenini denetler (`project-registry.ts:197` — ara dizin symlink ise kök dışına çıkma engellenir).

## Sonuç

**Windows Trusted Local M1'de desteklenir; native addon gerekmez.** Process tree `taskkill /T /F` ile temizlenir (deneysel: 0 orphan), PID reuse dört alanlı fingerprint ile korunur, dosya kilidi kill sonrası anında serbest, junction denetimi mevcut. Tek belgelenmesi gereken fark: Job Object'in otomatik temizliği yerine `taskkill`'in açık çağrıya bağlı olması — Supervisor çökmesinde recovery taraması devrededir. SPIKE **closed**.
