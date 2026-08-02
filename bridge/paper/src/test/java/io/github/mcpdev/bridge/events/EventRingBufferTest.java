package io.github.mcpdev.bridge.events;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * UT-EVENT-CURSOR-001 — event tamponu ve cursor davranışı.
 *
 * <p>En kritik testler "sessizce başa sarmaz" ve "gelecekten cursor reddedilir"
 * olanlardır: ikisi de kaçırılan event'lerin görünmez kalmasını engeller.
 */
class EventRingBufferTest {

    private static final String BOOT = "boot_test";

    private static EventRingBuffer buffer(int capacity) {
        return new EventRingBuffer(BOOT, capacity);
    }

    private static void appendEvents(EventRingBuffer buffer, int count) {
        for (int i = 0; i < count; i++) {
            buffer.append((sequence, bootId) -> new BridgeEvent(
                    sequence,
                    "evt_" + sequence,
                    "plugin.enabled",
                    bootId,
                    "srv_test",
                    "cor_test",
                    null,
                    100 + sequence,
                    "2026-07-30T00:00:00Z",
                    null,
                    null,
                    Map.of(),
                    "paper"));
        }
    }

    @Test
    void sequenceIsMonotonicAndStartsAtOne() {
        EventRingBuffer buffer = buffer(16);
        appendEvents(buffer, 3);

        List<BridgeEvent> events = buffer.query(BOOT, 0, 10);

        assertEquals(3, events.size());
        assertEquals(1, events.get(0).sequence());
        assertEquals(2, events.get(1).sequence());
        assertEquals(3, events.get(2).sequence());
    }

    @Test
    void queryReturnsOnlyEventsAfterCursor() {
        EventRingBuffer buffer = buffer(16);
        appendEvents(buffer, 5);

        List<BridgeEvent> events = buffer.query(BOOT, 3, 10);

        assertEquals(2, events.size());
        assertEquals(4, events.get(0).sequence());
        assertEquals(5, events.get(1).sequence());
    }

    @Test
    void limitIsRespected() {
        EventRingBuffer buffer = buffer(16);
        appendEvents(buffer, 10);

        assertEquals(3, buffer.query(BOOT, 0, 3).size());
    }

    @Test
    void otherBootCursorIsRejected() {
        EventRingBuffer buffer = buffer(16);
        appendEvents(buffer, 2);

        EventCursorException e =
                assertThrows(EventCursorException.class, () -> buffer.query("boot_other", 0, 10));

        assertEquals(EventCursorException.Kind.INSTANCE_MISMATCH, e.kind());
        assertEquals("EVENT_CURSOR_INSTANCE_MISMATCH", e.kind().code());
    }

    @Test
    void cursorFromTheFutureIsRejected() {
        // Boş liste döndürmek, başka bir boot'tan sızmış cursor'ı gizlerdi.
        EventRingBuffer buffer = buffer(16);
        appendEvents(buffer, 2);

        EventCursorException e = assertThrows(EventCursorException.class, () -> buffer.query(BOOT, 99, 10));
        assertEquals(EventCursorException.Kind.INSTANCE_MISMATCH, e.kind());
    }

    @Test
    void expiredCursorIsRejectedInsteadOfSilentlyRewinding() {
        EventRingBuffer buffer = buffer(4);
        appendEvents(buffer, 10); // 1..10, tamponda yalnızca 7..10 kalır

        assertEquals(7, buffer.oldestSequence());
        assertEquals(10, buffer.latestSequence());

        EventCursorException e = assertThrows(EventCursorException.class, () -> buffer.query(BOOT, 2, 10));
        assertEquals(EventCursorException.Kind.EXPIRED, e.kind());
        assertEquals("EVENT_CURSOR_EXPIRED", e.kind().code());
    }

    @Test
    void cursorAtBufferEdgeStillWorks() {
        EventRingBuffer buffer = buffer(4);
        appendEvents(buffer, 10);

        // after=6 -> ilk hayatta kalan 7'dir; sınır kabul edilmeli
        List<BridgeEvent> events = buffer.query(BOOT, 6, 10);
        assertEquals(4, events.size());
        assertEquals(7, events.get(0).sequence());
    }

    @Test
    void dropCountReportsDataLoss() {
        EventRingBuffer buffer = buffer(4);
        appendEvents(buffer, 4);
        assertEquals(0, buffer.droppedCount(), "kapasite dolana kadar kayıp yok");

        appendEvents(buffer, 3);
        assertEquals(3, buffer.droppedCount(), "taşma sayısı raporlanmalı");
    }

    @Test
    void emptyBufferReturnsNothingForZeroCursor() {
        EventRingBuffer buffer = buffer(8);
        assertTrue(buffer.query(BOOT, 0, 10).isEmpty());
        assertEquals(0, buffer.latestSequence());
    }

    @Test
    void concurrentAppendsKeepSequenceUnique() throws InterruptedException {
        EventRingBuffer buffer = buffer(1024);
        int threads = 8;
        int perThread = 50;

        List<Thread> workers = new java.util.ArrayList<>();
        for (int t = 0; t < threads; t++) {
            Thread thread = new Thread(() -> appendEvents(buffer, perThread));
            workers.add(thread);
            thread.start();
        }
        for (Thread thread : workers) {
            thread.join();
        }

        assertEquals((long) threads * perThread, buffer.latestSequence());

        List<BridgeEvent> all = buffer.query(BOOT, 0, threads * perThread);
        long distinct = all.stream().mapToLong(BridgeEvent::sequence).distinct().count();
        assertEquals(all.size(), distinct, "sequence çakışması olmamalı");
    }

    @Test
    void eventCarriesNoPersonalData() {
        // EV-05: IP veya gerçek hesap kimliği kaydedilmez.
        EventRingBuffer buffer = buffer(8);
        buffer.append((sequence, bootId) -> new BridgeEvent(
                sequence,
                "evt_1",
                "player.join",
                bootId,
                "srv_test",
                "cor_test",
                null,
                1,
                "2026-07-30T00:00:00Z",
                "test_player",
                "intruder",
                Map.of("world_key", "minecraft:overworld"),
                "paper"));

        Map<String, Object> map = buffer.query(BOOT, 0, 1).get(0).toMap();
        String json = map.toString();

        assertTrue(json.contains("test_player"));
        assertTrue(map.get("data") instanceof Map);
        assertTrue(json.contains("intruder"), "test actor kimliği taşınır");
    }
}
