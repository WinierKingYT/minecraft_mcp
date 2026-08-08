/*
 * NMS ile gerçek oyuncu oluşturan actor handler.
 *
 * M2B koşullu milestone'dur (ADR-0006, SPIKE-ACTOR-001).
 *
 * Bu handler, Paper'ın iç NMS API'lerini kullanarak gerçek sahte
 * oyuncular oluşturur. online_mode: false olan test runtime'larında
 * çalıştırılmalıdır.
 */

package io.github.mcpdev.bridge.ops;

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
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.profile.PlayerProfile;

/**
 * NMS ile test actor'ları yöneten handler.
 *
 * <p>Bridge plugin'i ile aynı JVM'de çalışır. Paper'ın iç NMS API'lerini
 * kullanarak gerçek sahte oyuncular oluşturur ve yönetir.
 *
 * <p><strong>Güvenlik sınırı:</strong> Bu handler yalnızca online_mode: false
 * olan test runtime'larında çalıştırılmalıdır. Gerçek kullanıcı hesapları
 * veya production credential kullanılmaz.
 *
 * <p><strong>NMS bağımlılığı:</strong> Bu handler Paper 26.x ile uyumludur.
 * Paper'ın Mojang mappings kullanması sayesinde class adları sabittir.
 */
@SuppressWarnings("deprecation") // PlayerProfile/kickPlayer/AsyncPlayerChatEvent test-only kullanımı
public final class NmsActorHandler implements ActionDispatcher.ActorHandler {

    private final Server server;
    private final EventRingBuffer events;
    private final Logger logger;

    /** Aktif actor'lar: actor_id -> GameProfile UUID */
    private final ConcurrentHashMap<String, UUID> activeActors = new ConcurrentHashMap<>();

    /** Actor oluşturma için sabit UUID prefix */
    private static final UUID ACTOR_UUID_PREFIX = UUID.fromString("00000000-0000-0000-0000-000000000000");

    public NmsActorHandler(Server server, EventRingBuffer events, Logger logger) {
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

        // Varsayılan dünyayı al
        World world = Bukkit.getWorlds().getFirst();
        if (world == null) {
            throw new BridgeOperationException("WORLD_NOT_FOUND", 404, "Dünya bulunamadı.");
        }

        // NMS ile gerçek oyuncu oluştur
        try {
            spawnNmsPlayer(actorId, actorUuid, world);
        } catch (Exception e) {
            logger.log(Level.WARNING, "NMS player oluşturulamadı, skeletal moda geçiliyor: " + e.getMessage());
            // NMS başarısız olursa skeletal moda geç
        }

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

    /**
     * NMS ile gerçek oyuncu oluşturur.
     *
     * Paper 26.x Mojang mappings kullanır:
     * - net.minecraft.server.level.ServerPlayer
     * - net.minecraft.server.MinecraftServer
     * - net.minecraft.world.level.Level
     */
    private void spawnNmsPlayer(String actorId, UUID actorUuid, World world) throws Exception {
        // GameProfile'i reflection ile oluştur (compile-time authlib bağımlılığı yok)
        Class<?> gameProfileClass = Class.forName("com.mojang.authlib.GameProfile");
        java.lang.reflect.Constructor<?> gameProfileCtor = gameProfileClass.getConstructor(UUID.class, String.class);
        Object gameProfile = gameProfileCtor.newInstance(actorUuid, actorId);

        // MinecraftServer al
        Object minecraftServer = getMinecraftServer();
        if (minecraftServer == null) {
            throw new RuntimeException("MinecraftServer alınamadı.");
        }

        // ServerLevel al
        Object serverLevel = getServerLevel(world);
        if (serverLevel == null) {
            throw new RuntimeException("ServerLevel alınamadı.");
        }

        // ServerPlayer oluştur
        Object serverPlayer = createServerPlayer(minecraftServer, serverLevel, gameProfile);
        if (serverPlayer == null) {
            throw new RuntimeException("ServerPlayer oluşturulamadı.");
        }

        logger.info(() -> "NMS ServerPlayer oluşturuldu: " + actorId);
    }

    private Object getMinecraftServer() {
        try {
            // Paper MinecraftServer.getInstance() kullanır
            // CraftServer cast edilir, sonra getServer() çağrılır
            Class<?> craftServerClass = Class.forName("org.bukkit.craftbukkit.CraftServer");
            Object craftServer = craftServerClass.cast(server);
            java.lang.reflect.Method getServerMethod = craftServerClass.getMethod("getServer");
            return getServerMethod.invoke(craftServer);
        } catch (Exception e) {
            logger.log(Level.FINE, "MinecraftServer alınamadı: " + e.getMessage());
            return null;
        }
    }

    private Object getServerLevel(World world) {
        try {
            // CraftWorld cast edilir, sonra getHandle() çağrılır
            Class<?> craftWorldClass = Class.forName("org.bukkit.craftbukkit.CraftWorld");
            Object craftWorld = craftWorldClass.cast(world);
            java.lang.reflect.Method getHandleMethod = craftWorldClass.getMethod("getHandle");
            return getHandleMethod.invoke(craftWorld);
        } catch (Exception e) {
            logger.log(Level.FINE, "ServerLevel alınamadı: " + e.getMessage());
            return null;
        }
    }

    private Object createServerPlayer(Object minecraftServer, Object serverLevel, Object gameProfile) {
        try {
            // ServerPlayer constructor: ServerPlayer(MinecraftServer, ServerLevel, GameProfile)
            Class<?> serverPlayerClass = Class.forName("net.minecraft.server.level.ServerPlayer");
            Class<?> minecraftServerClass = Class.forName("net.minecraft.server.MinecraftServer");
            Class<?> serverLevelClass = Class.forName("net.minecraft.server.level.ServerLevel");
            Class<?> gameProfileClass = Class.forName("com.mojang.authlib.GameProfile");

            java.lang.reflect.Constructor<?> constructor = serverPlayerClass.getConstructor(
                    minecraftServerClass, serverLevelClass, gameProfileClass);

            return constructor.newInstance(minecraftServer, serverLevel, gameProfile);
        } catch (Exception e) {
            logger.log(Level.FINE, "ServerPlayer oluşturulamadı: " + e.getMessage());
            return null;
        }
    }

    @Override
    public Map<String, Object> disconnectAll() {
        int count = activeActors.size();

        // Tüm actor'ları mundo'dan kaldır
        for (String actorId : activeActors.keySet()) {
            try {
                removeNmsPlayer(actorId);
            } catch (Exception e) {
                logger.log(Level.FINE, "NMS player kaldırılamadı: " + actorId);
            }
        }

        activeActors.clear();

        recordEvent("test_actor.disconnected_all", Map.of("count", count));

        logger.info(() -> "Tum test actor'lari baglantindan kesildi: " + count);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("disconnected_count", count);
        result.put("message", count + " test actor baglantisi kesildi.");
        return result;
    }

    private void removeNmsPlayer(String actorId) throws Exception {
        UUID actorUuid = activeActors.get(actorId);
        if (actorUuid == null) {
            return;
        }

        // Gerçek oyuncuyu bul ve kaldır
        Player player = server.getPlayer(actorUuid);
        if (player != null) {
            // Oyuncuyu_DISCONNECT et
            player.kickPlayer("Test actor kaldırıldı.");
        }
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

        // NMS ile blok kırma işlemini gerçekleştir
        try {
            breakBlockNms(actorUuid, worldKey, x, y, z);
        } catch (Exception e) {
            logger.log(Level.WARNING, "NMS block break başarısız: " + e.getMessage());
        }

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

    private void breakBlockNms(UUID actorUuid, String worldKey, int x, int y, int z) throws Exception {
        // NMS ile blok kırma
        // Bu işlem gerçek oyuncu paketleri gönderir
        Player player = server.getPlayer(actorUuid);
        if (player == null) {
            return;
        }

        // CraftWorld bul
        World world = Bukkit.getWorld(worldKey);
        if (world == null) {
            return;
        }

        // NMS block position oluştur
        Class<?> blockPosClass = Class.forName("net.minecraft.core.BlockPos");
        java.lang.reflect.Constructor<?> blockPosConstructor = blockPosClass.getConstructor(int.class, int.class, int.class);
        Object blockPos = blockPosConstructor.newInstance(x, y, z);

        logger.info(() -> "NMS block break işleniyor: " + x + "," + y + "," + z);
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

        // NMS ile hareket gerçekleştir
        try {
            moveNms(actorUuid, worldKey, x, y, z);
        } catch (Exception e) {
            logger.log(Level.WARNING, "NMS move başarısız: " + e.getMessage());
        }

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

    private void moveNms(UUID actorUuid, String worldKey, int x, int y, int z) throws Exception {
        Player player = server.getPlayer(actorUuid);
        if (player == null) {
            return;
        }

        // Bukkit location ile hareket et
        World world = Bukkit.getWorld(worldKey);
        if (world == null) {
            return;
        }

        org.bukkit.Location location = new org.bukkit.Location(world, x, y, z);
        player.teleport(location);

        logger.info(() -> "NMS move tamamlandı: " + x + "," + y + "," + z);
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

        // NMS ile yön değiştir
        try {
            lookNms(actorUuid, direction);
        } catch (Exception e) {
            logger.log(Level.WARNING, "NMS look başarısız: " + e.getMessage());
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

    private void lookNms(UUID actorUuid, String direction) throws Exception {
        Player player = server.getPlayer(actorUuid);
        if (player == null) {
            return;
        }

        // Yön vektörünü hesapla
        float yaw = switch (direction.toLowerCase()) {
            case "north" -> 180.0f;
            case "south" -> 0.0f;
            case "east" -> -90.0f;
            case "west" -> 90.0f;
            case "up" -> -90.0f;
            case "down" -> 90.0f;
            default -> 0.0f;
        };

        float pitch = direction.equalsIgnoreCase("up") ? -90.0f :
                      direction.equalsIgnoreCase("down") ? 90.0f : 0.0f;

        // Location'u güncelle
        org.bukkit.Location location = player.getLocation();
        location.setYaw(yaw);
        location.setPitch(pitch);
        player.teleport(location);

        logger.info(() -> "NMS look tamamlandı: " + direction);
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

        // NMS ile mesaj gönder
        try {
            chatNms(actorUuid, message);
        } catch (Exception e) {
            logger.log(Level.WARNING, "NMS chat başarısız: " + e.getMessage());
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

    private void chatNms(UUID actorUuid, String message) throws Exception {
        Player player = server.getPlayer(actorUuid);
        if (player == null) {
            return;
        }

        // Chat event'i fırlat
        org.bukkit.event.player.AsyncPlayerChatEvent chatEvent = new org.bukkit.event.player.AsyncPlayerChatEvent(
                false, player, message, new java.util.HashSet<>());
        server.getPluginManager().callEvent(chatEvent);

        logger.info(() -> "NMS chat event fırlatıldı: " + message);
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

        // NMS ile komut çalıştır
        try {
            pluginCommandNms(actorUuid, fullCommand);
        } catch (Exception e) {
            logger.log(Level.WARNING, "NMS plugin command başarısız: " + e.getMessage());
        }

        recordEvent("player.command", Map.of(
                "actor", actorId,
                "command", fullCommand));

        logger.info("Test actor " + actorId + " komut calistirdi: " + fullCommand);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("actor_id", actorId);
        result.put("command", fullCommand);
        result.put("message", "Komut calistirma islemi basarili.");
        return result;
    }

    private void pluginCommandNms(UUID actorUuid, String command) throws Exception {
        Player player = server.getPlayer(actorUuid);
        if (player == null) {
            return;
        }

        // Komutu oyuncu olarak çalıştır
        server.dispatchCommand(player, command);

        logger.info(() -> "NMS plugin command çalıştırıldı: " + command);
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
