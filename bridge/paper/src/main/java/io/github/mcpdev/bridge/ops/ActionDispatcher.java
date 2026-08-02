/**
 * Bridge action handler — mutation ve actor komutlarını işler.
 *
 * /v1/action endpoint'inden çağrılır. Actor komutları ve world.set_block
 * gibi mutation'lar burada işlenir.
 *
 * M2B koşullu milestone'dur (ADR-0006).
 */

package io.github.mcpdev.bridge.ops;

import io.github.mcpdev.bridge.generated.BridgeOperation;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Action dispatcher — operation'ları ilgili handler'a yönlendirir.
 *
 * <p>QueryDispatcher'dan farklı olarak bu dispatcher mutation çalıştırır.
 * Her mutation idempotency key gerektirir (bridge.md BR-08).
 */
public final class ActionDispatcher {

    /** Idempotency key -> sonuç önbelleği. Aynı key ile tekrarlanan istekler aynı sonucu döner. */
    private final ConcurrentHashMap<String, Map<String, Object>> idempotencyCache = new ConcurrentHashMap<>();

    /** Actor handler — Paper API ile entegre çalışır. */
    private final ActorHandler actorHandler;

    public ActionDispatcher(ActorHandler actorHandler) {
        this.actorHandler = actorHandler;
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

        Map<String, Object> result = switch (op) {
            case TEST_ACTOR_CREATE -> actorHandler.createActor(arguments);
            case TEST_ACTOR_DISCONNECT_ALL -> actorHandler.disconnectAll();
            case PLAYER_BREAK_BLOCK -> actorHandler.breakBlock(arguments);
            case PLAYER_MOVE -> actorHandler.move(arguments);
            case PLAYER_LOOK -> actorHandler.look(arguments);
            case PLAYER_CHAT -> actorHandler.chat(arguments);
            case PLUGIN_COMMAND -> actorHandler.pluginCommand(arguments);
            case PLAYER_GET_STATE -> actorHandler.getState(arguments);
            default -> throw new BridgeOperationException(
                    "UNSUPPORTED_OPERATION", 400,
                    "Bu operation action endpoint'i tarafından desteklenmiyor: " + operation);
        };

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
                 PLUGIN_COMMAND -> true;
            default -> false;
        };
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
            BridgeOperation.PLAYER_GET_STATE
    );
}
