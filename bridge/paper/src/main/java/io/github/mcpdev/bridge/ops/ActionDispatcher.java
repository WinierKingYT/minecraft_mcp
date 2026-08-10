/*
 * Bridge action handler — mutation ve actor komutlarını işler.
 *
 * /v1/action endpoint'inden çağrılır. Actor komutları ve world.set_block
 * gibi mutation'lar burada işlenir.
 *
 * M2B koşullu milestone'dur (ADR-0006).
 */

package io.github.mcpdev.bridge.ops;

import io.github.mcpdev.bridge.generated.BridgeOperation;
import io.github.mcpdev.bridge.scheduler.MainThreadExecutor;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Action dispatcher — mutation ve actor komutlarını işler.
 *
 * <p>/v1/action endpoint'inden çağrılır. Actor komutları ve world.set_block
 * gibi mutation'lar burada işlenir.
 *
 * <p>M2B koşullu milestone'dur (ADR-0006).
 */
public final class ActionDispatcher {

    /** Idempotency key -> sonuç önbelleği. Aynı key ile tekrarlanan istekler aynı sonucu döner. */
    private final ConcurrentHashMap<String, Map<String, Object>> idempotencyCache = new ConcurrentHashMap<>();

    /** Actor handler — Paper API ile entegre çalışır. */
    private final ActorHandler actorHandler;

    /** Dünya mutation'ları — world.set_block ve world.set_chunk_ticket. */
    private final WorldMutations worldMutations;

    /** Paper API çağrılarını ana thread'de çalıştırır. */
    private final MainThreadExecutor executor;

    /**
     * Action işlemi için üst sınır.
     *
     * <p>NMS actor join/komutları ana thread'de çalışır ve reflection içerir;
     * 2 saniye dar kalabilir, bu yüzden 5 saniyedir.
     */
    private static final Duration ACTION_TIMEOUT = Duration.ofSeconds(5);

    public ActionDispatcher(
            ActorHandler actorHandler, WorldMutations worldMutations, MainThreadExecutor executor) {
        this.actorHandler = actorHandler;
        this.worldMutations = worldMutations;
        this.executor = executor;
    }

    /**
     * Action operation'ını çalıştırır.
     *
     * @param operation   Bridge operation adı (ör. "test_actor.create")
     * @param arguments   Operation argümanları
     * @param idempotencyKey Mutation için zorunlu idempotency key
     * @return Operation sonucu
     * @throws BridgeOperationException Geçersiz operation veya eksik argüman
     */
    public Map<String, Object> dispatch(String operation, Map<String, Object> arguments, String idempotencyKey) {
        BridgeOperation op;
        try {
            op = BridgeOperation.fromWireName(operation);
        } catch (IllegalArgumentException e) {
            throw new BridgeOperationException(
                    "UNKNOWN_OPERATION", 400, "Bilinmeyen action operation: " + operation);
        }

        // Idempotency kontrolü — mutation'lar için zorunlu
        if (isMutation(op) && (idempotencyKey == null || idempotencyKey.isBlank())) {
            throw new BridgeOperationException(
                    "IDEMPOTENCY_KEY_REQUIRED", 400,
                    "Mutation operation'ları için idempotency_key zorunludur.");
        }

        // Idempotency cache kontrolü
        if (idempotencyKey != null && idempotencyCache.containsKey(idempotencyKey)) {
            return idempotencyCache.get(idempotencyKey);
        }

        // Paper API çağrıları ana thread'de çalışır (TH-02). Handler'lar
        // BlockBreakEvent/AsyncPlayerChatEvent fırlatır; bu event'ler sync
        // semantiği gerektirir ve HTTP thread'inden fırlatılamaz.
        Map<String, Object> result = executor.call(() -> switch (op) {
            case TEST_ACTOR_CREATE -> actorHandler.createActor(arguments);
            case TEST_ACTOR_DISCONNECT_ALL -> actorHandler.disconnectAll();
            case PLAYER_BREAK_BLOCK -> actorHandler.breakBlock(arguments);
            case PLAYER_MOVE -> actorHandler.move(arguments);
            case PLAYER_LOOK -> actorHandler.look(arguments);
            case PLAYER_CHAT -> actorHandler.chat(arguments);
            case PLUGIN_COMMAND -> actorHandler.pluginCommand(arguments);
            case PLAYER_GET_STATE -> actorHandler.getState(arguments);
            case WORLD_SET_BLOCK -> {
                String worldKey = requireString(arguments, "world_key");
                int x = requireInt(arguments, "x");
                int y = requireInt(arguments, "y");
                int z = requireInt(arguments, "z");
                String material = requireString(arguments, "material");
                yield worldMutations.setBlock(worldKey, x, y, z, material);
            }
            case WORLD_SET_CHUNK_TICKET -> {
                String worldKey = requireString(arguments, "world_key");
                int x = requireInt(arguments, "x");
                int z = requireInt(arguments, "z");
                Object radiusValue = arguments.get("radius");
                int radius = radiusValue instanceof Number n ? n.intValue() : 1;
                yield worldMutations.setChunkTicket(worldKey, x, z, radius);
            }
            default -> throw new BridgeOperationException(
                    "UNSUPPORTED_OPERATION", 400,
                    "Bu operation action endpoint'i tarafından desteklenmiyor: " + operation);
        }, ACTION_TIMEOUT);

        // Idempotency cache'e kaydet
        if (idempotencyKey != null) {
            idempotencyCache.put(idempotencyKey, result);
        }

        return result;
    }

    private boolean isMutation(BridgeOperation op) {
        return switch (op) {
            case TEST_ACTOR_CREATE, TEST_ACTOR_DISCONNECT_ALL,
                 PLAYER_BREAK_BLOCK, PLAYER_MOVE, PLAYER_LOOK, PLAYER_CHAT,
                 PLUGIN_COMMAND, WORLD_SET_BLOCK, WORLD_SET_CHUNK_TICKET -> true;
            default -> false;
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
        throw BridgeOperationException.invalidArguments("\"" + key + "\" tam sayı olmalıdır.");
    }

    /**
     * Actor handler arayüzü — Paper API ile entegre çalışır.
     *
     * <p>Bu arayüz, actor plugin tarafından implemente edilir.
     * Bridge, actor plugin'in bu arayüzü implemente etmesini bekler.
     */
    public interface ActorHandler {
        Map<String, Object> createActor(Map<String, Object> arguments);
        Map<String, Object> disconnectAll();
        Map<String, Object> breakBlock(Map<String, Object> arguments);
        Map<String, Object> move(Map<String, Object> arguments);
        Map<String, Object> look(Map<String, Object> arguments);
        Map<String, Object> chat(Map<String, Object> arguments);
        Map<String, Object> pluginCommand(Map<String, Object> arguments);
        Map<String, Object> getState(Map<String, Object> arguments);
    }

    /**
     * Actor handler'ın desteklediği operation'lar.
     */
    public static final Set<BridgeOperation> SUPPORTED_OPERATIONS = Set.of(
            BridgeOperation.TEST_ACTOR_CREATE,
            BridgeOperation.TEST_ACTOR_DISCONNECT_ALL,
            BridgeOperation.PLAYER_BREAK_BLOCK,
            BridgeOperation.PLAYER_MOVE,
            BridgeOperation.PLAYER_LOOK,
            BridgeOperation.PLAYER_CHAT,
            BridgeOperation.PLUGIN_COMMAND,
            BridgeOperation.PLAYER_GET_STATE,
            BridgeOperation.WORLD_SET_BLOCK,
            BridgeOperation.WORLD_SET_CHUNK_TICKET
    );
}
