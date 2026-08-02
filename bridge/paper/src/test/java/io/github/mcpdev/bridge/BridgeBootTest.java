package io.github.mcpdev.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** UT-EVENT-CURSOR-001 kapsamındaki boot kimliği ve sequence davranışı. */
class BridgeBootTest {

    @Test
    void bootIdIsPrefixedAndUnpredictable() {
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < 100; i++) {
            String id = BridgeBoot.create().bootId();
            assertTrue(id.startsWith("boot_"), "boot kimliği boot_ ön ekini taşımalı");
            assertEquals(5 + 32, id.length(), "16 bayt hex bekleniyor");
            ids.add(id);
        }
        assertEquals(100, ids.size(), "kimlikler tahmin edilemez ve çakışmasız olmalı");
    }

    @Test
    void sequenceIsMonotonicWithinBoot() {
        BridgeBoot boot = BridgeBoot.create();
        long previous = boot.currentEventSequence();
        for (int i = 0; i < 50; i++) {
            long next = boot.nextEventSequence();
            assertTrue(next > previous, "sequence boot içinde monoton olmalı");
            previous = next;
        }
    }

    @Test
    void separateBootsRestartSequenceAndDiffer() {
        BridgeBoot first = BridgeBoot.create();
        first.nextEventSequence();
        first.nextEventSequence();

        BridgeBoot second = BridgeBoot.create();

        assertNotEquals(first.bootId(), second.bootId());
        assertEquals(0, second.currentEventSequence(),
                "yeni boot sıfırdan başlar; bu yüzden cursor boot kimliğini de taşımak zorundadır");
    }
}
