package io.github.mcpdev.bridge.http;

import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * HTTP sunucusunun dış dünyaya bağlandığı nokta.
 *
 * <p>Bu kayıt sayesinde {@link BridgeHttpServer} Bukkit'ten ve event
 * tamponundan bağımsız kalır; sözleşme testleri sahte handler'larla koşabilir.
 */
public record BridgeEndpoints(
        Supplier<Map<String, Object>> health,
        Supplier<Map<String, Object>> capabilities,
        EventsHandler events,
        QueryHandler query,
        ActionHandler action) {

    /** {@code GET /v1/events?boot_id=&after=&limit=} */
    @FunctionalInterface
    public interface EventsHandler {
        List<Map<String, Object>> query(String bootId, long after, int limit);
    }

    /** {@code POST /v1/query} */
    @FunctionalInterface
    public interface QueryHandler {
        Map<String, Object> execute(String operation, Map<String, Object> arguments);
    }

    /** {@code POST /v1/action} — mutation ve actor komutları için. */
    @FunctionalInterface
    public interface ActionHandler {
        Map<String, Object> execute(String operation, Map<String, Object> arguments, String idempotencyKey);
    }

    /** Yalnızca health ve capabilities sunan minimal yapılandırma. */
    public static BridgeEndpoints readOnlyStub(
            Supplier<Map<String, Object>> health, Supplier<Map<String, Object>> capabilities) {
        return new BridgeEndpoints(
                health,
                capabilities,
                (bootId, after, limit) -> {
                    throw new UnsupportedOperationException("events");
                },
                (operation, arguments) -> {
                    throw new UnsupportedOperationException("query");
                },
                (operation, arguments, idempotencyKey) -> {
                    throw new UnsupportedOperationException("action");
                });
    }
}
