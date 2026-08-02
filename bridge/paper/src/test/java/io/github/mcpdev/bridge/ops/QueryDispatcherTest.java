package io.github.mcpdev.bridge.ops;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.mcpdev.bridge.generated.BridgeOperation;
import io.github.mcpdev.bridge.scheduler.BridgeTimeoutException;
import io.github.mcpdev.bridge.scheduler.MainThreadExecutor;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

/**
 * CT-QUERY-DISPATCH-001 — operation dağıtımı, argüman doğrulaması ve
 * mutation'ların query ucundan reddi.
 *
 * <p>Gerçek Paper GEREKTİRMEZ: {@link ReadOperations} ve
 * {@link MainThreadExecutor} sahte implementasyonlarla değiştirilir.
 */
class QueryDispatcherTest {

    private static final Duration TIMEOUT = Duration.ofSeconds(2);

    /** Görevi çağıran thread'de çalıştıran test double. */
    private static final class DirectExecutor implements MainThreadExecutor {
        private int calls;

        @Override
        public <T> T call(Supplier<T> task, Duration timeout) {
            calls++;
            return task.get();
        }
    }

    /** Her zaman timeout üreten test double. */
    private static final class TimingOutExecutor implements MainThreadExecutor {
        @Override
        public <T> T call(Supplier<T> task, Duration timeout) {
            throw new BridgeTimeoutException("test timeout", true);
        }
    }

    private static final class RecordingOperations implements ReadOperations {
        private final List<String> invoked = new ArrayList<>();

        @Override
        public Map<String, Object> serverState() {
            invoked.add("serverState");
            return Map.of("paper_version", "26.2", "server_tick", 4812L);
        }

        @Override
        public Map<String, Object> pluginList() {
            invoked.add("pluginList");
            return Map.of("plugins", List.of("PaperBridge"));
        }

        @Override
        public Map<String, Object> pluginGet(String pluginName) {
            invoked.add("pluginGet:" + pluginName);
            if (!"PaperBridge".equals(pluginName)) {
                throw BridgeOperationException.pluginNotFound(pluginName);
            }
            return Map.of("name", pluginName, "enabled", Boolean.TRUE);
        }

        @Override
        public Map<String, Object> worldList() {
            invoked.add("worldList");
            return Map.of("worlds", List.of("minecraft:overworld"));
        }

        @Override
        public Map<String, Object> worldGetBlock(String worldKey, int x, int y, int z) {
            invoked.add("worldGetBlock:" + worldKey + ":" + x + "," + y + "," + z);
            if (!"minecraft:overworld".equals(worldKey)) {
                throw BridgeOperationException.worldNotFound(worldKey);
            }
            return Map.of("material", "minecraft:stone");
        }

        @Override
        public Map<String, Object> playerState(String playerId) {
            invoked.add("playerState:" + playerId);
            return Map.of("id", playerId, "world_key", "minecraft:overworld");
        }
    }

    private static Map<String, Object> args(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            map.put((String) pairs[i], pairs[i + 1]);
        }
        return map;
    }

    @Test
    void dispatchesServerState() {
        RecordingOperations ops = new RecordingOperations();
        DirectExecutor executor = new DirectExecutor();
        QueryDispatcher dispatcher = new QueryDispatcher(ops, executor);

        Map<String, Object> result = dispatcher.dispatch("server.get_state", Map.of(), TIMEOUT);

        assertEquals("26.2", result.get("paper_version"));
        assertEquals(List.of("serverState"), ops.invoked);
        assertEquals(1, executor.calls, "Paper API çağrısı executor üzerinden gitmeli");
    }

    @Test
    void everyReadOperationGoesThroughTheExecutor() {
        // TH-02: HTTP worker thread'inden doğrudan Bukkit çağrılmamalı.
        RecordingOperations ops = new RecordingOperations();
        DirectExecutor executor = new DirectExecutor();
        QueryDispatcher dispatcher = new QueryDispatcher(ops, executor);

        dispatcher.dispatch("server.get_state", Map.of(), TIMEOUT);
        dispatcher.dispatch("plugin.list", Map.of(), TIMEOUT);
        dispatcher.dispatch("world.list", Map.of(), TIMEOUT);
        dispatcher.dispatch("plugin.get", args("plugin_name", "PaperBridge"), TIMEOUT);
        dispatcher.dispatch("player.get_state", args("player_id", "owner"), TIMEOUT);
        dispatcher.dispatch("world.get_block", args("world_key", "minecraft:overworld", "x", 1, "y", 64, "z", 2), TIMEOUT);

        assertEquals(6, executor.calls);
    }

    @Test
    void mutationOperationIsRejectedOnQueryEndpoint() {
        // world.set_block idempotency key ve seri kuyruk gerektirir; query
        // ucundan geçmesi kör retry'a kapı açardı.
        QueryDispatcher dispatcher = new QueryDispatcher(new RecordingOperations(), new DirectExecutor());

        BridgeOperationException e = assertThrows(
                BridgeOperationException.class,
                () -> dispatcher.dispatch("world.set_block", args("x", 1), TIMEOUT));

        assertEquals("TOOL_INPUT_INVALID", e.code());
        assertTrue(e.getMessage().contains("salt okuma değildir"));
    }

    @Test
    void unknownOperationYieldsCapabilityUnavailable() {
        QueryDispatcher dispatcher = new QueryDispatcher(new RecordingOperations(), new DirectExecutor());

        BridgeOperationException e = assertThrows(
                BridgeOperationException.class, () -> dispatcher.dispatch("world.explode", Map.of(), TIMEOUT));

        assertEquals("CAPABILITY_UNAVAILABLE", e.code());
        assertEquals(501, e.httpStatus());
    }

    @Test
    void missingArgumentIsRejected() {
        QueryDispatcher dispatcher = new QueryDispatcher(new RecordingOperations(), new DirectExecutor());

        BridgeOperationException e = assertThrows(
                BridgeOperationException.class, () -> dispatcher.dispatch("plugin.get", Map.of(), TIMEOUT));

        assertEquals("TOOL_INPUT_INVALID", e.code());
    }

    @Test
    void fractionalCoordinateIsRejected() {
        // Sessiz yuvarlama yanlış bloğu okuturdu.
        QueryDispatcher dispatcher = new QueryDispatcher(new RecordingOperations(), new DirectExecutor());

        assertThrows(
                BridgeOperationException.class,
                () -> dispatcher.dispatch(
                        "world.get_block",
                        args("world_key", "minecraft:overworld", "x", 1.5d, "y", 64, "z", 2),
                        TIMEOUT));
    }

    @Test
    void operationErrorsPropagateWithCatalogCodes() {
        QueryDispatcher dispatcher = new QueryDispatcher(new RecordingOperations(), new DirectExecutor());

        BridgeOperationException notFound = assertThrows(
                BridgeOperationException.class,
                () -> dispatcher.dispatch("plugin.get", args("plugin_name", "Nope"), TIMEOUT));
        assertEquals("PLUGIN_NOT_FOUND", notFound.code());
        assertEquals(404, notFound.httpStatus());

        BridgeOperationException world = assertThrows(
                BridgeOperationException.class,
                () -> dispatcher.dispatch(
                        "world.get_block", args("world_key", "minecraft:nether", "x", 0, "y", 0, "z", 0), TIMEOUT));
        assertEquals("WORLD_NOT_FOUND", world.code());
    }

    @Test
    void timeoutPropagatesAsBridgeTimeout() {
        QueryDispatcher dispatcher = new QueryDispatcher(new RecordingOperations(), new TimingOutExecutor());

        BridgeTimeoutException e = assertThrows(
                BridgeTimeoutException.class, () -> dispatcher.dispatch("server.get_state", Map.of(), TIMEOUT));

        assertTrue(e.taskCancelled(), "TH-05: süre aşımında görev iptal edilmiş olmalı");
        assertEquals("BRIDGE_TIMEOUT", BridgeTimeoutException.CODE);
    }

    @Test
    void readOnlySetMatchesRiskClassification() {
        // Mutation etkili hiçbir operation query ucunda olmamalı.
        assertTrue(QueryDispatcher.isReadOnly(BridgeOperation.SERVER_GET_STATE));
        assertTrue(QueryDispatcher.isReadOnly(BridgeOperation.WORLD_GET_BLOCK));
        assertTrue(QueryDispatcher.isReadOnly(BridgeOperation.PLAYER_GET_STATE));

        assertEquals(false, QueryDispatcher.isReadOnly(BridgeOperation.WORLD_SET_BLOCK));
    }
}
