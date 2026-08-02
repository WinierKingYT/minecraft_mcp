package io.github.mcpdev.bridge;

import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Bridge'in tek boot örneği.
 *
 * <p>{@code bridge_boot_id}, {@code server_instance_id}'den ayrıdır: bir Paper
 * process'i içinde Bridge yeniden yüklenebilir. Event cursor'ları her iki
 * kimliği birlikte taşır; böylece eski bir cursor yeni bir boot'ta sessizce
 * yanlış veri döndürmek yerine {@code EVENT_CURSOR_INSTANCE_MISMATCH} üretir
 * (docs/contracts/events-and-mutations.md).
 *
 * <p>Kimlikler tahmin edilemez olmak zorundadır: sıralı sayaç kullanılmaz
 * (docs/architecture/identities.md).
 */
public final class BridgeBoot {

    /** docs/contracts/bridge.md — bridge_protocol. */
    public static final int PROTOCOL_VERSION = 1;

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int ID_BYTES = 16;

    private final String bootId;
    private final long startedAtMillis;
    private final AtomicLong eventSequence = new AtomicLong(0);

    private BridgeBoot(String bootId, long startedAtMillis) {
        this.bootId = Objects.requireNonNull(bootId, "bootId");
        this.startedAtMillis = startedAtMillis;
    }

    public static BridgeBoot create() {
        return new BridgeBoot("boot_" + randomId(), System.currentTimeMillis());
    }

    private static String randomId() {
        byte[] bytes = new byte[ID_BYTES];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    public String bootId() {
        return bootId;
    }

    public long startedAtMillis() {
        return startedAtMillis;
    }

    /**
     * Sequence boot içinde monotondur (EV-01). Boot değiştiğinde sıfırdan
     * başlar; bu yüzden cursor'ın boot kimliğini de taşıması zorunludur.
     */
    public long nextEventSequence() {
        return eventSequence.incrementAndGet();
    }

    public long currentEventSequence() {
        return eventSequence.get();
    }
}
