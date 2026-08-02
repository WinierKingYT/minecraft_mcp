package io.github.mcpdev.bridge.scheduler;

import java.time.Duration;
import java.util.function.Supplier;

/**
 * Paper API çağrılarını doğru thread'de çalıştırır.
 *
 * <p>docs/contracts/bridge.md TH-02: Paper API işlemleri uygun scheduler'da
 * çalışmalıdır. HTTP worker thread'inden doğrudan Bukkit çağırmak, sunucu
 * durumunu bozar ve teşhisi zor eşzamanlılık hataları üretir.
 *
 * <p><strong>TH-05 (kritik):</strong> Timeout, ana thread'de kontrolsüz bir
 * görev bırakmamalıdır. Terk edilmiş bir görev, "iptal edildi" sanılan bir
 * işlemi geç uygulayarak scenario determinizmini bozar. Bu yüzden
 * implementasyonlar timeout'ta görevi <em>iptal etmek</em> zorundadır, yalnızca
 * beklemeyi bırakmak yetmez.
 */
public interface MainThreadExecutor {

    /**
     * Görevi ana thread'de çalıştırır ve sonucu bekler.
     *
     * @throws BridgeTimeoutException süre aşılırsa; görev iptal edilmiş olmalıdır
     */
    <T> T call(Supplier<T> task, Duration timeout);
}
