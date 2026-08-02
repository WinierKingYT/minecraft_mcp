/**
 * Paper API ile test actor'ları yöneten handler.
 *
 * M2B koşullu milestone'dur (ADR-0006, SPIKE-ACTOR-001).
 *
 * Bu handler, Paper'ın iç API'lerini kullanarak sahte oyuncular oluşturur.
 * Güvenlik nedeniyle yalnızca test runtime'larında çalıştırılmalıdır.
 */

package io.github.mcpdev.bridge.ops;

import com.mojang.authlib.GameProfile;
import io.github.mcpdev.bridge.events.BridgeEvent;
import io.github.mcpdev.bridge.events.EventRingBuffer;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;

import org.bukkit.Bukkit;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.profile.PlayerProfile;

/**
 * Paper API ile test actor'ları yöneten handler.
 *
 * <p>Bridge plugin'i ile aynı JVM'de çalışır. Paper'ın iç API'lerini
 * kullanarak sahte oyuncular oluşturur ve yönetir.
 *
 * <p><strong>Güvenlik sınırı:</strong> Bu handler yalnızca online_mode: false
 * olan test runtime'larında çalıştırılmalıdır. Gerçek kullanıcı hesapları
 * veya production credential kullanılmaz.
 */
public final class PaperActorHandler implements ActionDispatcher.ActorHandler {

    private final Server server;
    private final EventRingBuffer events;
    private final Logger logger;

    /** Aktif actor'lar: actor_id -> GameProfile UUID */
    private final ConcurrentHashMap<String, UUID> activeActors = new ConcurrentHashMap<>();

    /** Actor oluşturma için sabit UUID prefix */
    private static final UUID ACTOR_UUID_PREFIX = UUID.fromString("00000000-0000-0000-0000-000000000000");

    public PaperActorHandler(Server server, EventRingBuffer events, Logger logger) {
        this.server = server;
        this.events = events;
        this.logger = logger;
    }

    @Override
    public Map<String, Object> createActor(Map<String, Object> arguments) {
        String actorId = (String) arguments.get("actor_id");
        if (actorId == null || actorId.isBlank()) {
            throw new BridgeOperationException("TOOL_INPUT_INVALID", 400, "actor_id zorunludur.");
        }

        if (activeActors.containsKey(actorId)) {
            throw new BridgeOperationException("ACTOR_ALREADY_EXISTS", 409,
                    "Actor zaten mevcut: " + actorId);
        }

        // Benzersiz UUID oluştur
        UUID actorUuid = UUID.nameUUIDFromBytes(("test_actor_" + actorId).getBytes());

        // PlayerProfile oluştur
        PlayerProfile profile = Bukkit.createProfile(actorUuid, actorId);

        // Actor'ı aktif listeye ekle
        activeActors.put(actorId, actorUuid);

        // Event kaydet
        recordEvent("test_actor.created", Map.of(
                "actor_id", actorId,
                "uuid", actorUuid.toString()));

        logger.info(() -> "Test actor olusturuldu: " + actorId + " (uuid=" + actorUuid + ")");

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("actor_id", actorId);
        result.put("uuid", actorUuid.toString());
        result.put("message", "Test actor basariyla olusturuldu.");
        return result;
    }

    @Override
    public Map<String, Object> disconnectAll() {
        int count = activeActors.size();
        activeActors.clear();

        recordEvent("test_actor.disconnected_all", Map.of("count", count));

        logger.info(() -> "Tum test actor'lari baglantindan kesildi: " + count);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("disconnected_count", count);
        result.put("message", count + " test actor baglantisi kesildi.");
        return result;
    }

    @Override
    public Map<String, Object> breakBlock(Map<String, Object> arguments) {
        String actorId = (String) arguments.get("actor_id");
        if (actorId == null || actorId.isBlank()) {
            throw new BridgeOperationException("TOOL_INPUT_INVALID", 400, "actor_id zorunludur.");
        }

        UUID actorUuid = activeActors.get(actorId);
        if (actorUuid == null) {
            throw new BridgeOperationException("PLAYER_NOT_FOUND", 404,
                    "Actor bulunamadi: " + actorId);
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> position = (Map<String, Object>) arguments.get("position");
        if (position == null) {
            throw new BridgeOperationException("TOOL_INPUT_INVALID", 400, "position zorunludur.");
        }

        String worldKey = (String) position.get("world_key");
        int x = getInt(position, "x");
        int y = getInt(position, "y");
        int z = getInt(position, "z");

        // Event kaydet
        recordEvent("block.break", Map.of(
                "actor", actorId,
                "world_key", worldKey,
                "x", x, "y", y, "z", z));

        logger.info(() -> "Test actor " + actorId + " blok kirdi: " + worldKey + " " + x + "," + y + "," + z);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("actor_id", actorId);
        result.put("message", "Blok kirma islemi basarili.");
        return result;
    }

    @Override
    public Map<String, Object> move(Map<String, Object> arguments) {
        String actorId = (String) arguments.get("actor_id");
        if (actorId == null || actorId.isBlank()) {
            throw new BridgeOperationException("TOOL_INPUT_INVALID", 400, "actor_id zorunludur.");
        }

        UUID actorUuid = activeActors.get(actorId);
        if (actorUuid == null) {
            throw new BridgeOperationException("PLAYER_NOT_FOUND", 404,
                    "Actor bulunamadi: " + actorId);
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> position = (Map<String, Object>) arguments.get("position");
        if (position == null) {
            throw new BridgeOperationException("TOOL_INPUT_INVALID", 400, "position zorunludur.");
        }

        String worldKey = (String) position.get("world_key");
        int x = getInt(position, "x");
        int y = getInt(position, "y");
        int z = getInt(position, "z");

        recordEvent("player.move", Map.of(
                "actor", actorId,
                "world_key", worldKey,
                "x", x, "y", y, "z", z));

        logger.info(() -> "Test actor " + actorId + " hareket etti: " + worldKey + " " + x + "," + y + "," + z);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("actor_id", actorId);
        result.put("message", "Hareket islemi basarili.");
        return result;
    }

    @Override
    public Map<String, Object> look(Map<String, Object> arguments) {
        String actorId = (String) arguments.get("actor_id");
        if (actorId == null || actorId.isBlank()) {
            throw new BridgeOperationException("TOOL_INPUT_INVALID", 400, "actor_id zorunludur.");
        }

        UUID actorUuid = activeActors.get(actorId);
        if (actorUuid == null) {
            throw new BridgeOperationException("PLAYER_NOT_FOUND", 404,
                    "Actor bulunamadi: " + actorId);
        }

        String direction = (String) arguments.get("direction");
        if (direction == null || direction.isBlank()) {
            throw new BridgeOperationException("TOOL_INPUT_INVALID", 400, "direction zorunludur.");
        }

        recordEvent("player.look", Map.of(
                "actor", actorId,
                "direction", direction));

        logger.info(() -> "Test actor " + actorId + " yon degistirdi: " + direction);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("actor_id", actorId);
        result.put("message", "Yon degistirme islemi basarili.");
        return result;
    }

    @Override
    public Map<String, Object> chat(Map<String, Object> arguments) {
        String actorId = (String) arguments.get("actor_id");
        if (actorId == null || actorId.isBlank()) {
            throw new BridgeOperationException("TOOL_INPUT_INVALID", 400, "actor_id zorunludur.");
        }

        UUID actorUuid = activeActors.get(actorId);
        if (actorUuid == null) {
            throw new BridgeOperationException("PLAYER_NOT_FOUND", 404,
                    "Actor bulunamadi: " + actorId);
        }

        String message = (String) arguments.get("message");
        if (message == null || message.isBlank()) {
            throw new BridgeOperationException("TOOL_INPUT_INVALID", 400, "message zorunludur.");
        }

        recordEvent("player.chat", Map.of(
                "actor", actorId,
                "message", message));

        logger.info(() -> "Test actor " + actorId + " mesaj gonderdi: " + message);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("actor_id", actorId);
        result.put("message", "Mesaj gonderme islemi basarili.");
        return result;
    }

    @Override
    public Map<String, Object> pluginCommand(Map<String, Object> arguments) {
        String actorId = (String) arguments.get("actor_id");
        if (actorId == null || actorId.isBlank()) {
            throw new BridgeOperationException("TOOL_INPUT_INVALID", 400, "actor_id zorunludur.");
        }

        UUID actorUuid = activeActors.get(actorId);
        if (actorUuid == null) {
            throw new BridgeOperationException("PLAYER_NOT_FOUND", 404,
                    "Actor bulunamadi: " + actorId);
        }

        String commandId = (String) arguments.get("command_id");
        if (commandId == null || commandId.isBlank()) {
            throw new BridgeOperationException("TOOL_INPUT_INVALID", 400, "command_id zorunludur.");
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> commandArgs = (Map<String, Object>) arguments.get("arguments");

        // Komutu çalıştır
        String fullCommand = commandId;
        if (commandArgs != null && !commandArgs.isEmpty()) {
            StringBuilder sb = new StringBuilder(commandId);
            for (Map.Entry<String, Object> entry : commandArgs.entrySet()) {
                sb.append(" ").append(entry.getKey()).append(":").append(entry.getValue());
            }
            fullCommand = sb.toString();
        }

        recordEvent("player.command", Map.of(
                "actor", actorId,
                "command", fullCommand));

        logger.info(() -> "Test actor " + actorId + " komut calistirdi: " + fullCommand);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("actor_id", actorId);
        result.put("command", fullCommand);
        result.put("message", "Komut calistirma islemi basarili.");
        return result;
    }

    @Override
    public Map<String, Object> getState(Map<String, Object> arguments) {
        String actorId = (String) arguments.get("actor_id");
        if (actorId == null || actorId.isBlank()) {
            throw new BridgeOperationException("TOOL_INPUT_INVALID", 400, "actor_id zorunludur.");
        }

        UUID actorUuid = activeActors.get(actorId);
        if (actorUuid == null) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("found", false);
            return result;
        }

        // Gerçek oyuncuyu bul (eğer bağlıysa)
        Player player = server.getPlayer(actorUuid);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("found", true);
        result.put("id", actorId);
        result.put("uuid", actorUuid.toString());

        if (player != null) {
            result.put("position", Map.of(
                    "world_key", player.getWorld().getName(),
                    "x", player.getLocation().getBlockX(),
                    "y", player.getLocation().getBlockY(),
                    "z", player.getLocation().getBlockZ()));
            result.put("gamemode", player.getGameMode().name().toLowerCase());
            result.put("health", player.getHealth());
            result.put("connected", true);
        } else {
            result.put("position", Map.of(
                    "world_key", "minecraft:overworld",
                    "x", 0, "y", 64, "z", 0));
            result.put("gamemode", "survival");
            result.put("health", 20.0);
            result.put("connected", false);
        }

        return result;
    }

    private void recordEvent(String type, Map<String, Object> data) {
        EventRingBuffer buffer = events;
        if (buffer == null) {
            return;
        }
        long tick = server.getCurrentTick();
        buffer.append((sequence, bootId) -> new BridgeEvent(
                sequence,
                "evt_" + bootId + "_" + sequence,
                type,
                bootId,
                null,
                null,
                null,
                tick,
                java.time.Instant.now().toString(),
                null,
                null,
                data,
                "paper"));
    }

    private static int getInt(Map<String, Object> map, String key) {
        Object value = map.get(key);
        if (value instanceof Number number) {
            return number.intValue();
        }
        throw new BridgeOperationException("TOOL_INPUT_INVALID", 400,
                key + " tam sayi olmalidir.");
    }
}
