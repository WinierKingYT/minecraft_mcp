package io.github.mcpdev.bridge.ops;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.mcpdev.bridge.generated.BridgeOperation;
import io.github.mcpdev.bridge.scheduler.MainThreadExecutor;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

/**
 * CT-WORLD-SET-001 / CT-WORLD-TICKET-001 — dünya mutation'larının dağıtımı,
 * idempotency zorunluluğu ve argüman doğrulaması.
 *
 * <p>Gerçek Paper GEREKTİRMEZ: {@link WorldMutations} ve
 * {@link MainThreadExecutor} sahte implementasyonlarla değiştirilir.
 */
class ActionDispatcherTest {

    private static final class DirectExecutor implements MainThreadExecutor {
        @Override
        public <T> T call(Supplier<T> task, Duration timeout) {
            return task.get();
        }
    }

    private static final class RecordingWorldMutations implements WorldMutations {
        private final List<String> invoked = new ArrayList<>();

        @Override
        public Map<String, Object> setBlock(String worldKey, int x, int y, int z, String material) {
            invoked.add("setBlock:" + worldKey + ":" + x + "," + y + "," + z + ":" + material);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("world_key", worldKey);
            result.put("x", x);
            result.put("y", y);
            result.put("z", z);
            result.put("material", material);
            return result;
        }

        @Override
        public Map<String, Object> setChunkTicket(String worldKey, int x, int z, int radius) {
            invoked.add("setChunkTicket:" + worldKey + ":" + x + "," + z + ":" + radius);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("world_key", worldKey);
            result.put("chunk_x", x >> 4);
            result.put("chunk_z", z >> 4);
            result.put("radius", radius);
            result.put("forced_chunks", (2 * radius + 1) * (2 * radius + 1));
            return result;
        }
    }

    private static final class FailingActorHandler implements ActionDispatcher.ActorHandler {
        @Override
        public Map<String, Object> createActor(Map<String, Object> arguments) {
            throw new AssertionError("actor çağrılmamalı");
        }

        @Override
        public Map<String, Object> disconnectAll() {
            throw new AssertionError("actor çağrılmamalı");
        }

        @Override
        public Map<String, Object> breakBlock(Map<String, Object> arguments) {
            throw new AssertionError("actor çağrılmamalı");
        }

        @Override
        public Map<String, Object> move(Map<String, Object> arguments) {
            throw new AssertionError("actor çağrılmamalı");
        }

        @Override
        public Map<String, Object> look(Map<String, Object> arguments) {
            throw new AssertionError("actor çağrılmamalı");
        }

        @Override
        public Map<String, Object> chat(Map<String, Object> arguments) {
            throw new AssertionError("actor çağrılmamalı");
        }

        @Override
        public Map<String, Object> pluginCommand(Map<String, Object> arguments) {
            throw new AssertionError("actor çağrılmamalı");
        }

        @Override
        public Map<String, Object> getState(Map<String, Object> arguments) {
            throw new AssertionError("actor çağrılmamalı");
        }
    }

    private ActionDispatcher dispatcher(RecordingWorldMutations mutations) {
        return new ActionDispatcher(new FailingActorHandler(), mutations, new DirectExecutor());
    }

    @Test
    void setBlockYonlendirirVeSonucuDoner() {
        RecordingWorldMutations mutations = new RecordingWorldMutations();
        ActionDispatcher dispatcher = dispatcher(mutations);

        Map<String, Object> result = dispatcher.dispatch(
                "world.set_block",
                Map.of("world_key", "minecraft:overworld", "x", 10, "y", 64, "z", 10, "material", "minecraft:stone"),
                "idem-1");

        assertEquals("minecraft:overworld", result.get("world_key"));
        assertEquals("minecraft:stone", result.get("material"));
        assertEquals(List.of("setBlock:minecraft:overworld:10,64,10:minecraft:stone"), mutations.invoked);
    }

    @Test
    void setChunkTicketYonlendirirVeVarsayilanYaricapiKullanir() {
        RecordingWorldMutations mutations = new RecordingWorldMutations();
        ActionDispatcher dispatcher = dispatcher(mutations);

        Map<String, Object> result = dispatcher.dispatch(
                "world.set_chunk_ticket",
                Map.of("world_key", "minecraft:overworld", "x", 10, "z", 10),
                "idem-2");

        assertEquals(1, result.get("radius"));
        assertEquals(9, result.get("forced_chunks"));
        assertEquals(List.of("setChunkTicket:minecraft:overworld:10,10:1"), mutations.invoked);
    }

    @Test
    void mutationIdempotencyKeyZorunludur() {
        ActionDispatcher dispatcher = dispatcher(new RecordingWorldMutations());

        BridgeOperationException err = assertThrows(BridgeOperationException.class, () ->
                dispatcher.dispatch(
                        "world.set_block",
                        Map.of("world_key", "minecraft:overworld", "x", 10, "y", 64, "z", 10, "material", "minecraft:stone"),
                        null));

        assertEquals("IDEMPOTENCY_KEY_REQUIRED", err.code());
    }

    @Test
    void ayniIdempotencyKeyIleTekrarlananIstekOnbellektenDoner() {
        RecordingWorldMutations mutations = new RecordingWorldMutations();
        ActionDispatcher dispatcher = dispatcher(mutations);

        Map<String, Object> args = Map.of(
                "world_key", "minecraft:overworld", "x", 10, "y", 64, "z", 10, "material", "minecraft:stone");

        dispatcher.dispatch("world.set_block", args, "idem-3");
        Map<String, Object> second = dispatcher.dispatch("world.set_block", args, "idem-3");

        assertEquals(1, mutations.invoked.size());
        assertEquals("minecraft:stone", second.get("material"));
    }

    @Test
    void eksikArgumanToolInputInvalidUretir() {
        ActionDispatcher dispatcher = dispatcher(new RecordingWorldMutations());

        BridgeOperationException err = assertThrows(BridgeOperationException.class, () ->
                dispatcher.dispatch(
                        "world.set_block",
                        Map.of("world_key", "minecraft:overworld", "x", 10, "y", 64, "z", 10),
                        "idem-4"));

        assertEquals("TOOL_INPUT_INVALID", err.code());
    }

    @Test
    void desteklenenOperationlarBildirilir() {
        assertTrue(ActionDispatcher.SUPPORTED_OPERATIONS.contains(BridgeOperation.WORLD_SET_BLOCK));
        assertTrue(ActionDispatcher.SUPPORTED_OPERATIONS.contains(BridgeOperation.WORLD_SET_CHUNK_TICKET));
    }
}
