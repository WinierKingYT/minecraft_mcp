package io.github.mcpdev.bridge.events;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Sınırlı (bounded) event tamponu.
 *
 * <p>docs/contracts/events-and-mutations.md EV-01..EV-03:
 *
 * <ul>
 *   <li>Sequence boot içinde monotondur.</li>
 *   <li>Tampon sınırlıdır; en eski kayıtlar düşer.</li>
 *   <li>Düşen bir kayda işaret eden cursor <strong>açık hata</strong> üretir —
 *       sessizce sıfırlanmaz.</li>
 * </ul>
 *
 * <p>Son madde kritiktir: cursor sessizce başa sarılırsa ajan, kaçırdığı
 * event'leri görmüş sanır ve assertion'lar yanlış geçer.
 *
 * <p>Bukkit API'sine bağımlılığı yoktur; gerçek Paper olmadan sınanabilir.
 */
public final class EventRingBuffer {

    /** Varsayılan kapasite. Aşımı EVENT_BUFFER_OVERFLOW olarak raporlanır. */
    public static final int DEFAULT_CAPACITY = 4096;

    private final Object lock = new Object();
    private final BridgeEvent[] slots;
    private final String bootId;

    private long nextSequence = 1;
    private long droppedCount;

    public EventRingBuffer(String bootId, int capacity) {
        if (capacity < 1) {
            throw new IllegalArgumentException("capacity >= 1 olmalı");
        }
        this.bootId = Objects.requireNonNull(bootId, "bootId");
        this.slots = new BridgeEvent[capacity];
    }

    public int capacity() {
        return slots.length;
    }

    public String bootId() {
        return bootId;
    }

    /** Kaç event'in tampondan düştüğü. Sıfırdan büyükse veri kaybı olmuştur. */
    public long droppedCount() {
        synchronized (lock) {
            return droppedCount;
        }
    }

    public long latestSequence() {
        synchronized (lock) {
            return nextSequence - 1;
        }
    }

    /** Tampondaki en eski sequence; tampon boşsa 0. */
    public long oldestSequence() {
        synchronized (lock) {
            long latest = nextSequence - 1;
            if (latest == 0) {
                return 0;
            }
            long oldest = latest - Math.min(latest, slots.length) + 1;
            return oldest;
        }
    }

    /**
     * Event'i tampona yazar ve atanan sequence'i döndürür.
     *
     * <p>Çağıran {@code sequence} alanını doldurmaz; numarayı tampon atar.
     * Böylece iki farklı üreticinin aynı numarayı kullanması imkânsızdır.
     */
    public long append(EventFactory factory) {
        synchronized (lock) {
            long sequence = nextSequence++;
            int index = (int) ((sequence - 1) % slots.length);
            if (slots[index] != null) {
                droppedCount++;
            }
            slots[index] = factory.create(sequence, bootId);
            return sequence;
        }
    }

    /**
     * {@code after} sequence'inden SONRAKİ event'leri döndürür.
     *
     * @throws EventCursorException cursor başka bir boot'a aitse veya işaret
     *     ettiği kayıt tampondan düşmüşse
     */
    public List<BridgeEvent> query(String cursorBootId, long after, int limit) {
        if (!bootId.equals(cursorBootId)) {
            throw new EventCursorException(
                    EventCursorException.Kind.INSTANCE_MISMATCH,
                    "Cursor boot " + cursorBootId + " bu Bridge boot'una (" + bootId + ") ait değil.");
        }
        if (after < 0) {
            throw new EventCursorException(
                    EventCursorException.Kind.INSTANCE_MISMATCH, "Cursor sequence negatif olamaz.");
        }
        if (limit < 1) {
            throw new IllegalArgumentException("limit >= 1 olmalı");
        }

        synchronized (lock) {
            long latest = nextSequence - 1;
            if (after > latest) {
                // Gelecekten bir cursor: ya başka bir boot'tan sızmış ya da
                // istemci hata yapıyor. Boş liste döndürmek bunu gizlerdi.
                throw new EventCursorException(
                        EventCursorException.Kind.INSTANCE_MISMATCH,
                        "Cursor sequence " + after + " en son sequence'ten (" + latest + ") büyük.");
            }

            long oldest = latest == 0 ? 0 : latest - Math.min(latest, slots.length) + 1;
            if (latest > 0 && after > 0 && after < oldest - 1) {
                throw new EventCursorException(
                        EventCursorException.Kind.EXPIRED,
                        "Cursor sequence " + after + " tampondan düşmüş (en eski: " + oldest + ").");
            }

            List<BridgeEvent> out = new ArrayList<>();
            for (long seq = Math.max(after + 1, oldest); seq <= latest && out.size() < limit; seq++) {
                BridgeEvent event = slots[(int) ((seq - 1) % slots.length)];
                if (event != null && event.sequence() == seq) {
                    out.add(event);
                }
            }
            return List.copyOf(out);
        }
    }

    /** Sequence ve boot kimliği tampon tarafından atanır. */
    @FunctionalInterface
    public interface EventFactory {
        BridgeEvent create(long sequence, String bootId);
    }
}
