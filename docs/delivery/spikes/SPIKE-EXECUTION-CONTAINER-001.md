# SPIKE-EXECUTION-CONTAINER-001 — Container execution backend

**Durum:** open
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

_(spike sırasında doldurulur)_

## Sonuç

_(bir cümlelik karar + ADR bağlantısı)_
