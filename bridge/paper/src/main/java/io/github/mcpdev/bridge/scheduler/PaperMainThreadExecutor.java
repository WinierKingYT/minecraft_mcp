package io.github.mcpdev.bridge.scheduler;

import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import org.bukkit.Server;
import org.bukkit.plugin.Plugin;

/**
 * Bukkit scheduler tabanlı {@link MainThreadExecutor}.
 *
 * <p>TH-05'i şöyle karşılar: her görev bir "abandoned" bayrağı taşır. Timeout
 * olduğunda bayrak işaretlenir ve zamanlanmış görev iptal edilir. Görev ana
 * thread'e ulaşmayı başarsa bile bayrağı görüp <em>hiçbir şey yapmadan</em>
 * döner. Böylece süre aşımından sonra Paper durumu değişmez.
 */
public final class PaperMainThreadExecutor implements MainThreadExecutor {

    private final Plugin plugin;
    private final Server server;

    public PaperMainThreadExecutor(Plugin plugin, Server server) {
        this.plugin = plugin;
        this.server = server;
    }

    @Override
    public <T> T call(Supplier<T> task, Duration timeout) {
        // Zaten ana thread'deysek zamanlamaya gerek yok; ayrıca kendi
        // kendimizi bekleyip kilitlenmeyi önler.
        if (server.isPrimaryThread()) {
            return task.get();
        }

        AtomicBoolean abandoned = new AtomicBoolean(false);
        CompletableFuture<T> future = new CompletableFuture<>();

        var scheduled = server.getScheduler().runTask(plugin, () -> {
            if (abandoned.get()) {
                // Süre aşımı sonrası ana thread'e ulaşan görev HİÇBİR ŞEY yapmaz.
                return;
            }
            try {
                future.complete(task.get());
            } catch (RuntimeException e) {
                future.completeExceptionally(e);
            }
        });

        try {
            return future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            abandoned.set(true);
            scheduled.cancel();
            throw new BridgeTimeoutException(
                    "Paper API çağrısı " + timeout.toMillis() + " ms içinde tamamlanmadı.", true);
        } catch (InterruptedException e) {
            abandoned.set(true);
            scheduled.cancel();
            Thread.currentThread().interrupt();
            throw new BridgeTimeoutException("Bekleme kesildi.", true);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof RuntimeException runtime) {
                throw runtime;
            }
            throw new IllegalStateException("Paper API çağrısı başarısız", cause);
        }
    }
}
