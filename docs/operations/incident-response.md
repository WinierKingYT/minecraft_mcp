# Incident response

Olay müdahalesi prosedürleri. Bu belge gerçek olaylar için çalıştırma talimatları sağlar.

## Secret sızıntısı

**Tetikleme:** CI loglarında, evidence dosyalarında veya raporlarda token/secret görüldü.

**Adımlar:**

1. **Hemen:** İlgili token'ı/patenti devre dışı bırak (GitHub token, Paper API key, vb.)
2. **Kapsamı belirle:** Hangi log'larda, hangi zaman aralığında görünüyor?
3. **Evidence koru:** İlgili log dosyalarını ve evidence manifest'lerini silme — bunlar soruşturmanın kanıtıdır.
4. **CI durdur:** Varsa çalışan CI pipeline'larını iptal et.
5. **Token rotasyonu:** Devre dışı bırakılan token'ı yenisiyle değiştir.
6. **Root cause:** Token nasıl sızdı? Hangi dosyada, hangi kodda?
7. **Düzeltme:** Kod düzeltmesi, CI hardening, veya her ikisi.

**Kontrol listesi:**

- [ ] Token devre dışı bırakıldı
- [ ] Kapsam belirlendi
- [ ] Evidence korundu
- [ ] CI iptal edildi
- [ ] Token rotasyonu yapıldı
- [ ] Root cause analiz edildi
- [ ] Düzeltme uygulandı

## Orphan process

**Tetikleme:** `mcpdev doctor` orphan process raporluyor veya manuel gözlem.

**Adımlar:**

1. **Tanımla:** `ps aux | grep -E 'paper|gradle|java'` ile orphan process'leri bul.
2. **PID ve ownership kontrolü:** Process'in PID, executable path, başlangıç zamanı ve runtime marker fingerprint'ini kaydet.
3. **Sahiplik doğrula:** `verifyOwnership()` fonksiyonuyla 4-alan eşleşmesini kontrol et.
   - Eşleşmiyorsa → **PROCESS_OWNERSHIP_MISMATCH** — Bu process bizim değil, dokunma.
   - Eşleşiyorsa → Sahiplik doğrulandı, öldürebilirsin.
4. **Sonlandır:** `forceKill()` ile sonlandır (platform-aware: Windows'ta `taskkill /T /F`, POSIX'te process group SIGKILL).
5. **Port doğrula:** `isPortBound()` ile port'un serbest kaldığını doğrula.
6. **Tekrar kontrol:** 5 saniye bekle, tekrar `ps` ile kontrol et.

**Kontrol listesi:**

- [ ] Orphan process tanımlandı
- [ ] Ownership doğrulandı (4 alan)
- [ ] Process sonlandırıldı
- [ ] Port serbest bırakıldı
- [ ] Tekrar kontrol edildi

## Disk tükenmesi

**Tetikleme:** `mcpdev doctor` disk uyarısı veya build/runtime hatası.

**Adımlar:**

1. **Kapsamı belirle:** Hangi dizinler disk kullanımı yüksek?
   - `node_modules/` — en büyük aday
   - `apps/*/dist/` — build çıktıları
   - `bridge/paper/build/` — Java build
   - `fixtures/` — test verileri
   - Runtime dizinleri (geçici, otomatik temizlenmeli)
2. **Temizle (sırayla):**
   - `mcpdev uninstall` — build çıktılarını ve node_modules'u kaldırır
   - Gradle cache: `~/.gradle/caches/` (opsiyonel, agresif)
   - Runtime dizinleri: `/tmp/mcpdev-*` veya equivalent
3. **Doğrula:** `mcpdev doctor` ile disk durumunu kontrol et.
4. **Önleme:** CI'da disk kotası ekle, runtime retention politikası uygula.

**Kontrol listesi:**

- [ ] Kapsam belirlendi
- [ ] Temizlik yapıldı
- [ ] Doğrulandı
- [ ] Önleme alındı

## Build hatası (supply-chain)

**Tetikleme:** Gradle wrapper verification başarısız, lock file tutarsız, veya dependency verification hatası.

**Adımlar:**

1. **Wrapper kontrolü:** `gradle/wrapper/gradle-wrapper.jar` dosyasının checksum'ı doğrulanmış mı?
2. **Lock file kontrolü:** `gradle.lockfile` ve `pnpm-lock.yaml` tutarlı mı?
3. **Verification metadata:** `gradle/verification-metadata.xml` mevcut ve doğru mu?
4. **Dynamic version:** Build script'te dynamic version (`+`, `latest`, `current`) var mı?
5. **Cache temizle:** `gradle clean` ve `rm -rf node_modules` yap.
6. **Yeniden dene:** `pnpm install && pnpm run build`.

**Kontrol listesi:**

- [ ] Wrapper doğrulandı
- [ ] Lock files tutarlı
- [ ] Verification metadata mevcut
- [ ] Dynamic version yok
- [ ] Cache temizlendi
- [ ] Build başarılı

## Paper crash

**Tetikleme:** Paper JVM çöktü, Bridge handshake başarısız, veya ready gate geçilmedi.

**Adımlar:**

1. **Log'ları topla:** Paper log dosyasını bul ve son 100 satırı kaydet.
2. **Crash sebebini belirle:** OutOfMemory, stack overflow, veya plugin exception?
3. **Bridge durumunu kontrol et:** `GET /health` endpoint'i çalışıyor mu?
4. **Recovery:** Supervisor otomatik recovery başlatmalı. Başarısızsa manuel olarak Paper'ı yeniden başlat.
5. **Plugin kontrolü:** Plugin disable edildi mi? Bridge thread/port temizlendi mi?

**Kontrol listesi:**

- [ ] Log'lar toplandı
- [ ] Crash sebebi belirlendi
- [ ] Bridge durumu kontrol edildi
- [ ] Recovery başlatıldı
- [ ] Plugin durumu doğrulandı

## İletişim

- **Güvenlik açığı:** Doğrudan repository maintainers'a bildir.
- **CI başarısızlığı:** İlgili PR'da yorum bırak.
- **Orphan/disk/build:** Bu belgedeki adımları takip et.
