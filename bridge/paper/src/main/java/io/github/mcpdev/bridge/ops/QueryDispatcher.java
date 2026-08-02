package io.github.mcpdev.bridge.ops;

import io.github.mcpdev.bridge.generated.BridgeOperation;
import io.github.mcpdev.bridge.scheduler.MainThreadExecutor;

import java.time.Duration;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * {@code POST /v1/query} operation dağıtıcısı.
 *
 * <p>Yalnızca <strong>salt okuma</strong> operation'ları kabul eder. Mutation
 * operation'ları (örn. {@code world.set_block}) bu uçtan çağrılamaz: mutation
 * idempotency key, seri kuyruk ve mutation ledger gerektirir; bunları query
 * yoluna sızdırmak kör retry'a kapı açardı.
 *
 * <p>İzin verilen operation kümesi capability registry'den üretilen
 * {@link BridgeOperation} enum'una bağlıdır; elle tutulan bir string listesi
 * yoktur.
 */
public final class QueryDispatcher {

    /** Query ucundan çağrılabilecek operation'lar (hepsi risk R0). */
    private static final Set<BridgeOperation> READ_ONLY = EnumSet.of(
            BridgeOperation.SERVER_GET_STATE,
            BridgeOperation.PLUGIN_LIST,
            BridgeOperation.PLUGIN_GET,
            BridgeOperation.WORLD_LIST,
            BridgeOperation.WORLD_GET_BLOCK,
            BridgeOperation.PLAYER_GET_STATE);

    private final ReadOperations operations;
    private final MainThreadExecutor executor;

    public QueryDispatcher(ReadOperations operations, MainThreadExecutor executor) {
        this.operations = operations;
        this.executor = executor;
    }

    public static boolean isReadOnly(BridgeOperation operation) {
        return READ_ONLY.contains(operation);
    }

    /**
     * Operation'ı çözer, argümanları doğrular ve ana thread'de çalıştırır.
     *
     * @throws BridgeOperationException bilinmeyen/izinsiz operation veya geçersiz argüman
     */
    public Map<String, Object> dispatch(String operationName, Map<String, Object> arguments, Duration timeout) {
        BridgeOperation operation;
        try {
            operation = BridgeOperation.fromWireName(operationName);
        } catch (IllegalArgumentException e) {
            throw BridgeOperationException.capabilityUnavailable(operationName);
        }

        if (!isReadOnly(operation)) {
            throw new BridgeOperationException(
                    "TOOL_INPUT_INVALID",
                    400,
                    "\"" + operationName + "\" salt okuma değildir; /v1/query üzerinden çağrılamaz.");
        }

        return switch (operation) {
            case SERVER_GET_STATE -> executor.call(operations::serverState, timeout);
            case PLUGIN_LIST -> executor.call(operations::pluginList, timeout);
            case WORLD_LIST -> executor.call(operations::worldList, timeout);
            case PLUGIN_GET -> {
                String name = requireString(arguments, "plugin_name");
                yield executor.call(() -> operations.pluginGet(name), timeout);
            }
            case PLAYER_GET_STATE -> {
                String id = requireString(arguments, "player_id");
                yield executor.call(() -> operations.playerState(id), timeout);
            }
            case WORLD_GET_BLOCK -> {
                String worldKey = requireString(arguments, "world_key");
                int x = requireInt(arguments, "x");
                int y = requireInt(arguments, "y");
                int z = requireInt(arguments, "z");
                yield executor.call(() -> operations.worldGetBlock(worldKey, x, y, z), timeout);
            }
            default -> throw BridgeOperationException.capabilityUnavailable(operationName);
        };
    }

    private static String requireString(Map<String, Object> arguments, String key) {
        Object value = arguments.get(key);
        if (!(value instanceof String s) || s.isBlank()) {
            throw BridgeOperationException.invalidArguments("\"" + key + "\" boş olmayan bir metin olmalıdır.");
        }
        return s;
    }

    private static int requireInt(Map<String, Object> arguments, String key) {
        Object value = arguments.get(key);
        if (value instanceof Integer i) {
            return i;
        }
        if (value instanceof Long l && l >= Integer.MIN_VALUE && l <= Integer.MAX_VALUE) {
            return l.intValue();
        }
        // Ondalıklı koordinat kabul edilmez: blok koordinatları tam sayıdır ve
        // sessiz yuvarlama yanlış bloğu okuturdu.
        throw BridgeOperationException.invalidArguments("\"" + key + "\" tam sayı olmalıdır.");
    }
}
