# SPIKE-WINDOWS-PROCESS-001 — Windows process tree ownership ve cleanup

**Durum:** open
**Blokladığı:** M1, KPI-06
**Zaman kutusu:** 2–3 gün

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

_(spike sırasında doldurulur)_

## Sonuç

_(bir cümlelik karar + ADR bağlantısı)_
