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

import java.lang.reflect.Method;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
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

        // NMS ile gerçek oyuncu oluştur ve join et
        boolean joined = false;
        String joinError = null;
        try {
            joined = spawnAndJoinPlayer(actorId, actorUuid);
        } catch (Exception e) {
            Throwable cause = (e instanceof java.lang.reflect.InvocationTargetException ite
                    && ite.getCause() != null) ? ite.getCause() : e;
            joinError = (cause.getClass().getSimpleName() + ": " + String.valueOf(cause.getMessage())).trim();
            logger.log(Level.WARNING, "NMS player join başarısız, skeletal moda geçiliyor: "
                    + joinError, cause);
        }

        final boolean joinedResult = joined;
        final String joinErrorResult = joinError;

        // Actor'ı aktif listeye ekle
        activeActors.put(actorId, actorUuid);

        // Event kaydet
        recordEvent("test_actor.created", actorId, actorUuid, Map.of(
                "actor_id", actorId,
                "uuid", actorUuid.toString(),
                "joined", joinedResult,
                "join_error", joinErrorResult == null ? "" : joinErrorResult));

        logger.info(() -> "Test actor olusturuldu: " + actorId + " (uuid=" + actorUuid
                + ", joined=" + joinedResult + ")");

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("actor_id", actorId);
        result.put("uuid", actorUuid.toString());
        result.put("joined", joinedResult);
        result.put("join_error", joinErrorResult == null ? "" : joinErrorResult);
        result.put("message", joinedResult
                ? "Test actor olusturuldu ve dünyaya eklendi."
                : "Test actor olusturuldu (skeletal mod).");
        return result;
    }

    /**
     * NMS ile gerçek oyuncu oluşturur ve PlayerList'e ekler.
     *
     * <p>Paper 26.x Mojang mappings kullanır:
     * - net.minecraft.server.level.ServerPlayer
     * - net.minecraft.server.MinecraftServer
     * - net.minecraft.server.players.PlayerList
     *
     * <p>Paper fork'unda {@code PlayerList.addPlayer(ServerPlayer)} halka açıktır;
     * oyuncu dünyaya eklenir ve {@code server.getPlayer(uuid)} ile erişilebilir hale gelir.
     *
     * @return join başarılı ise {@code true}
     */
    private boolean spawnAndJoinPlayer(String actorId, UUID actorUuid) throws Exception {
        // GameProfile'i reflection ile oluştur (compile-time authlib bağımlılığı yok)
        Class<?> gameProfileClass = Class.forName("com.mojang.authlib.GameProfile");
        java.lang.reflect.Constructor<?> gameProfileCtor = gameProfileClass.getConstructor(UUID.class, String.class);
        Object gameProfile = gameProfileCtor.newInstance(actorUuid, actorId);

        // MinecraftServer al
        Object minecraftServer = getMinecraftServer();
        if (minecraftServer == null) {
            throw new RuntimeException("MinecraftServer alınamadı.");
        }

        // Varsayılan dünyayı al
        World world = Bukkit.getWorlds().getFirst();
        if (world == null) {
            throw new RuntimeException("Dünya bulunamadı.");
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

        // Oyuncuyu sunucuya ekle: CraftServer.addPlayer(ServerPlayer) tercih
        // edilir (Paper API yüzeyi, connection/cookie derdi yok); bulunamazsa
        // PlayerList.placeNewPlayer akışına düşülür.
        addPlayerToServer(serverPlayer);

        // Konum: actor'ı dünya spawn noktasına taşı
        Location spawn = world.getSpawnLocation();
        teleportTo(world, spawn.getBlockX(), spawn.getBlockY(), spawn.getBlockZ());

        Player online = server.getPlayer(actorUuid);
        if (online == null) {
            throw new RuntimeException("addPlayer sonrası oyuncu bulunamadı.");
        }

        logger.info(() -> "NMS ServerPlayer join edildi: " + actorId);
        return true;
    }

    private Object getPlayerList(Object minecraftServer) throws Exception {
        Class<?> minecraftServerClass = Class.forName("net.minecraft.server.MinecraftServer");
        Method getPlayerListMethod = minecraftServerClass.getMethod("getPlayerList");
        return getPlayerListMethod.invoke(minecraftServer);
    }

    /**
     * Oyuncuyu sunucuya ekler.
     *
     * <p>Paper'ın {@code CraftServer.addPlayer(ServerPlayer)} API'si tercih
     * edilir: connection/cookie kurulumunu Paper yönetir ve oyuncu
     * {@code server.getPlayer(uuid)} ile erişilebilir hale gelir. Method
     * yoksa vanilla {@code PlayerList.placeNewPlayer} akışına düşülür.
     */
    private void addPlayerToServer(Object serverPlayer) throws Exception {
        Class<?> craftServerClass = Class.forName("org.bukkit.craftbukkit.CraftServer");
        for (Method method : craftServerClass.getMethods()) {
            if (method.getName().equals("addPlayer")
                    && method.getParameterCount() == 1
                    && method.getParameterTypes()[0].isAssignableFrom(serverPlayer.getClass())) {
                method.invoke(server, serverPlayer);
                return;
            }
        }

        // Fallback: PlayerList.placeNewPlayer(Connection, ServerPlayer, CommonListenerCookie)
        Object minecraftServer = getMinecraftServer();
        Object playerList = getPlayerList(minecraftServer);
        if (playerList == null) {
            throw new RuntimeException("PlayerList alınamadı.");
        }
        Method placeNewPlayer = null;
        for (Method method : playerList.getClass().getMethods()) {
            if (method.getName().equals("placeNewPlayer")) {
                for (Class<?> paramType : method.getParameterTypes()) {
                    if (paramType.isAssignableFrom(serverPlayer.getClass())) {
                        placeNewPlayer = method;
                        break;
                    }
                }
                if (placeNewPlayer != null) {
                    break;
                }
            }
        }
        if (placeNewPlayer == null) {
            throw new RuntimeException("CraftServer.addPlayer ve PlayerList.placeNewPlayer bulunamadı.");
        }
        Object connection = createMemoryConnection();
        Object cookie = createListenerCookie(serverPlayer);
        placeNewPlayer.invoke(playerList, connection, serverPlayer, cookie);
    }

    /**
     * Sıfır bağlantı için {@code Connection} örneği üretir.
     *
     * <p>Test actor'ları gerçek ağ bağlantısına sahip değildir; vanilla
     * login akışında kullanılan bağlantı refleksiyonla kurulur. Paper 26.x'te
     * {@code Connection} abstract olabilir; {@code MemoryConnection}
     * (1.21.2+) alt sınıfı tercih edilir.
     */
    private Object createMemoryConnection() throws Exception {
        // Paper 26.x: Connection(PacketFlow) — tek ctor; paket adı sürümler
        // arası değişebileceğinden parametre tipi refleksiyonla çözülür.
        Class<?> connectionClass = Class.forName("net.minecraft.network.Connection");
        for (java.lang.reflect.Constructor<?> ctor : connectionClass.getDeclaredConstructors()) {
            if (ctor.getParameterCount() == 1) {
                Class<?> flowClass = ctor.getParameterTypes()[0];
                @SuppressWarnings({ "unchecked", "rawtypes" })
                Object serverbound = Enum.valueOf((Class<? extends Enum>) flowClass, "SERVERBOUND");
                ctor.setAccessible(true);
                Object connection = ctor.newInstance(serverbound);
                injectChannel(connection, connectionClass);
                return connection;
            }
        }
        throw new RuntimeException("Connection tek parametreli ctor bulunamadı.");
    }

    /**
     * Connection örneğinin {@code channel} alanına EmbeddedChannel enjekte
     * eder. Test actor'larının gerçek ağ bağlantısı yoktur; boş channel,
     * packet yazımında {@code writeAndFlush} NPE'sini önler.
     */
    private void injectChannel(Object connection, Class<?> connectionClass) throws Exception {
        Class<?> embeddedChannelClass = Class.forName("io.netty.channel.embedded.EmbeddedChannel");
        Class<?> channelInterface = Class.forName("io.netty.channel.Channel");
        Object channel = embeddedChannelClass.getDeclaredConstructor().newInstance();
        for (java.lang.reflect.Field field : connectionClass.getDeclaredFields()) {
            if (field.getName().equals("channel")
                    && channelInterface.isAssignableFrom(field.getType())) {
                field.setAccessible(true);
                field.set(connection, channel);
                return;
            }
        }
        StringBuilder names = new StringBuilder();
        for (java.lang.reflect.Field field : connectionClass.getDeclaredFields()) {
            names.append(field.getName()).append(':').append(field.getType().getSimpleName()).append(';');
        }
        throw new RuntimeException("channel alanı bulunamadı. fields=" + names);
    }

    /**
     * {@code CommonListenerCookie} üretir.
     *
     * <p>Static {@code create*} factory'lerinden ilk uygun olan kullanılır;
     * bilinmeyen parametre tiplerine {@code null} verilir (isteğe bağlı
     * imza/anahtar alanları nullable'dır).
     */
    private Object createListenerCookie(Object serverPlayer) throws Exception {
        Class<?> cookieClass = Class.forName("net.minecraft.server.network.CommonListenerCookie");
        for (Method method : cookieClass.getMethods()) {
            if (!java.lang.reflect.Modifier.isStatic(method.getModifiers())
                    || !method.getName().startsWith("create")) {
                continue;
            }
            Class<?>[] params = method.getParameterTypes();
            Object[] args = new Object[params.length];
            boolean ok = true;
            for (int i = 0; i < params.length; i++) {
                if (params[i].isAssignableFrom(serverPlayer.getClass())) {
                    args[i] = serverPlayer;
                } else if (params[i].isPrimitive()) {
                    args[i] = params[i] == boolean.class ? Boolean.FALSE : null;
                } else {
                    args[i] = null;
                }
                if (params[i].isPrimitive() && args[i] == null) {
                    ok = false;
                    break;
                }
            }
            if (!ok) {
                continue;
            }
            try {
                return method.invoke(null, args);
            } catch (IllegalArgumentException iae) {
                // Bu factory kombinasyonu uygun değil; bir sonrakini dene.
            }
        }
        throw new RuntimeException("CommonListenerCookie create factory bulunamadı.");
    }

    private Method findAddPlayerMethod(Object playerList, Object serverPlayer) {
        Class<?> playerListClass = playerList.getClass();
        Class<?> serverPlayerClass = serverPlayer.getClass();
        // Not: getDeclaredMethods() yalnızca DedicatedPlayerList'in kendi
        // method'larını döner; oyuncu method'ları üst sınıfta olduğundan
        // getMethods() (public + inherited) kullanılmalıdır.
        // Paper: addPlayer(ServerPlayer) — sürümler arası imza değişebilir.
        for (Method method : playerListClass.getMethods()) {
            if (method.getName().equals("addPlayer")) {
                for (Class<?> paramType : method.getParameterTypes()) {
                    if (paramType.isAssignableFrom(serverPlayerClass)) {
                        return method;
                    }
                }
            }
        }
        // Vanilla akışı: placeNewPlayer(Connection, ServerPlayer, CommonListenerCookie)
        for (Method method : playerListClass.getMethods()) {
            if (method.getName().equals("placeNewPlayer")) {
                for (Class<?> paramType : method.getParameterTypes()) {
                    if (paramType.isAssignableFrom(serverPlayerClass)) {
                        return method;
                    }
                }
            }
        }
        return null;
    }

    /** Teşhis: PlayerList üzerinde hangi method'ların olduğunu döker. */
    private static String describeMethods(Class<?> playerListClass, Class<?> serverPlayerClass) {
        StringBuilder sb = new StringBuilder("class=" + playerListClass.getName());
        int shown = 0;
        for (Method method : playerListClass.getMethods()) {
            if (shown >= 40) {
                break;
            }
            boolean relevant = method.getName().startsWith("add")
                    || method.getName().startsWith("place")
                    || method.getName().startsWith("join")
                    || method.getName().startsWith("remove")
                    || method.getName().startsWith("disconnect")
                    || method.getName().startsWith("get");
            if (!relevant) {
                continue;
            }
            sb.append(", ").append(method.getName()).append('(')
                    .append(method.getParameterCount()).append(')');
            shown++;
        }
        return sb.toString();
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
            Class<?> serverPlayerClass = Class.forName("net.minecraft.server.level.ServerPlayer");
            Class<?> minecraftServerClass = Class.forName("net.minecraft.server.MinecraftServer");
            Class<?> serverLevelClass = Class.forName("net.minecraft.server.level.ServerLevel");

            // Paper 26.x: ServerPlayer ctor imzaları sürümler arası değişir.
            // 1) (MinecraftServer, ServerLevel, GameProfile)
            // 2) (MinecraftServer, ServerLevel, GameProfile, ClientInformation)
            for (java.lang.reflect.Constructor<?> ctor : serverPlayerClass.getDeclaredConstructors()) {
                Class<?>[] params = ctor.getParameterTypes();
                if (params.length == 3
                        && minecraftServerClass.isAssignableFrom(params[0])
                        && serverLevelClass.isAssignableFrom(params[1])
                        && params[2].isAssignableFrom(gameProfile.getClass())) {
                    ctor.setAccessible(true);
                    return ctor.newInstance(minecraftServer, serverLevel, gameProfile);
                }
            }
            for (java.lang.reflect.Constructor<?> ctor : serverPlayerClass.getDeclaredConstructors()) {
                Class<?>[] params = ctor.getParameterTypes();
                if (params.length >= 4
                        && minecraftServerClass.isAssignableFrom(params[0])
                        && serverLevelClass.isAssignableFrom(params[1])
                        && params[2].isAssignableFrom(gameProfile.getClass())) {
                    // 4. parametre bir client information tipi olmalıdır
                    // (ör. net.minecraft.server.network.ClientInformation); static
                    // createDefault() factory'si ile varsayılan değer üretilir.
                    Object clientInfo;
                    try {
                        java.lang.reflect.Method createDefault = params[3].getMethod("createDefault");
                        clientInfo = createDefault.invoke(null);
                    } catch (NoSuchMethodException nsme) {
                        continue;
                    }
                    ctor.setAccessible(true);
                    Object[] args = new Object[params.length];
                    args[0] = minecraftServer;
                    args[1] = serverLevel;
                    args[2] = gameProfile;
                    args[3] = clientInfo;
                    return ctor.newInstance(args);
                }
            }
        } catch (Exception e) {
            logger.log(Level.FINE, "ServerPlayer oluşturulamadı: " + e);
        }
        return null;
    }

    @Override
    public Map<String, Object> disconnectAll() {
        int count = activeActors.size();

        // Tüm actor'ları dünyadan kaldır
        for (String actorId : activeActors.keySet()) {
            try {
                removeNmsPlayer(actorId);
            } catch (Exception e) {
                logger.log(Level.FINE, "NMS player kaldırılamadı: " + actorId);
            }
        }

        activeActors.clear();

        recordEvent("test_actor.disconnected_all", null, null, Map.of("count", count));

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

        Player player = server.getPlayer(actorUuid);
        if (player == null) {
            return;
        }

        // Kick: vanilla akışını dener (embedded channel'da kısmi kalabilir;
        // kayıt temizliği aşağıda garantilenir).
        try {
            player.kickPlayer("Test actor kaldırıldı.");
        } catch (Exception e) {
            logger.log(Level.FINE, "Kick başarısız: " + e.getMessage());
        }

        // PlayerList kayıtlarından doğrudan çıkar: tip bazlı tarama (alan
        // adları sürümler arası değişebilir: playersByUUID/players/playerById).
        Object playerList = getPlayerList(getMinecraftServer());
        if (playerList == null) {
            return;
        }
        Object serverPlayer = player.getClass().getMethod("getHandle").invoke(player);
        for (Class<?> current = playerList.getClass(); current != null; current = current.getSuperclass()) {
            for (java.lang.reflect.Field field : current.getDeclaredFields()) {
                try {
                    field.setAccessible(true);
                    Object value = field.get(playerList);
                    if (value instanceof Map<?, ?> map) {
                        for (Object key : map.keySet().toArray()) {
                            Object entryValue = map.get(key);
                            if (entryValue == serverPlayer || key.equals(actorUuid)) {
                                map.remove(key);
                            }
                        }
                    } else if (value instanceof java.util.List<?> list) {
                        list.remove(serverPlayer);
                    }
                } catch (ReflectiveOperationException e) {
                    logger.log(Level.FINE, "PlayerList alan temizliği başarısız: " + field.getName()
                            + " " + e.getMessage());
                }
            }
        }
    }

    /** Dünyayı NamespacedKey veya isimle bulur (Bukkit.getWorld(key) sürümler arası tutarsız). */
    private World findWorld(String worldKey) {
        for (World world : Bukkit.getWorlds()) {
            if (world.getKey().toString().equals(worldKey) || world.getName().equals(worldKey)) {
                return world;
            }
        }
        return null;
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

        boolean cancelled = false;
        boolean dispatched = false;
        try {
            cancelled = !breakBlockNms(actorUuid, worldKey, x, y, z);
            dispatched = true;
        } catch (Exception e) {
            logger.log(Level.WARNING, "NMS block break başarısız: " + e.getMessage());
        }

        // Event kaydet — iptal semantiği dahil
        recordEvent("block.break", actorId, actorUuid, Map.of(
                "actor_id", actorId,
                "world_key", worldKey,
                "x", x, "y", y, "z", z,
                "cancelled", cancelled,
                "dispatched", dispatched));

        logger.info("Test actor " + actorId + " blok kirdi: " + worldKey + " " + x + "," + y + "," + z
                + " (cancelled=" + cancelled + ")");

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("actor_id", actorId);
        result.put("cancelled", cancelled);
        result.put("message", cancelled
                ? "Blok kirma islemi basarili (event iptal edildi)."
                : "Blok kirma islemi basarili.");
        return result;
    }

    /**
     * Gerçek {@link BlockBreakEvent} fırlatarak blok kırar.
     *
     * <p>Plugin listener'ları tetiklenir (ADR-0006: plugin'in kendi listener'ı
     * atlanamaz); event iptal edilmezse blok havaya dönüşür. İptal edilirse
     * blok yerinde kalır ve sonuçta {@code cancelled=true} döner.
     *
     * @return event iptal edilmedi ise {@code true}
     */
    private boolean breakBlockNms(UUID actorUuid, String worldKey, int x, int y, int z) throws Exception {
        Player player = server.getPlayer(actorUuid);
        if (player == null) {
            return false;
        }

        World world = findWorld(worldKey);
        if (world == null) {
            return false;
        }

        // Oyuncuyu blok önüne ışınla (gerçekçi konum bağlamı)
        Location target = new Location(world, x + 0.5, y, z + 0.5);
        player.teleport(target);

        Block block = world.getBlockAt(x, y, z);
        BlockBreakEvent event = new BlockBreakEvent(block, player);
        server.getPluginManager().callEvent(event);

        boolean cancelled = event.isCancelled();
        if (!cancelled) {
            block.setType(Material.AIR, false);
        }

        return !cancelled;
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
        boolean dispatched = false;
        try {
            dispatched = moveNms(actorUuid, worldKey, x, y, z);
        } catch (Exception e) {
            logger.log(Level.WARNING, "NMS move başarısız: " + e.getMessage());
        }

        recordEvent("player.move", actorId, actorUuid, Map.of(
                "actor_id", actorId,
                "world_key", worldKey,
                "x", x, "y", y, "z", z,
                "dispatched", dispatched));

        logger.info(() -> "Test actor " + actorId + " hareket etti: " + worldKey + " " + x + "," + y + "," + z);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("actor_id", actorId);
        result.put("dispatched", dispatched);
        result.put("message", "Hareket islemi basarili.");
        return result;
    }

    private boolean moveNms(UUID actorUuid, String worldKey, int x, int y, int z) throws Exception {
        Player player = server.getPlayer(actorUuid);
        if (player == null) {
            return false;
        }

        // Bukkit location ile hareket et
        World world = findWorld(worldKey);
        if (world == null) {
            return false;
        }

        teleportTo(world, x, y, z);

        logger.info(() -> "NMS move tamamlandı: " + x + "," + y + "," + z);
        return true;
    }

    private void teleportTo(World world, int x, int y, int z) {
        // Oyuncu yoksa hiçbir şey yapma; varsa konum güncelle
        for (Player player : server.getOnlinePlayers()) {
            if (activeActors.containsValue(player.getUniqueId())) {
                player.teleport(new Location(world, x + 0.5, y, z + 0.5));
                return;
            }
        }
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
        boolean dispatched = false;
        try {
            dispatched = lookNms(actorUuid, direction);
        } catch (Exception e) {
            logger.log(Level.WARNING, "NMS look başarısız: " + e.getMessage());
        }

        recordEvent("player.look", actorId, actorUuid, Map.of(
                "actor_id", actorId,
                "direction", direction,
                "dispatched", dispatched));

        logger.info(() -> "Test actor " + actorId + " yon degistirdi: " + direction);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("actor_id", actorId);
        result.put("dispatched", dispatched);
        result.put("message", "Yon degistirme islemi basarili.");
        return result;
    }

    private boolean lookNms(UUID actorUuid, String direction) throws Exception {
        Player player = server.getPlayer(actorUuid);
        if (player == null) {
            return false;
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
        Location location = player.getLocation();
        location.setYaw(yaw);
        location.setPitch(pitch);
        player.teleport(location);

        logger.info(() -> "NMS look tamamlandı: " + direction);
        return true;
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
        boolean cancelled = false;
        boolean dispatched = false;
        try {
            cancelled = chatNms(actorUuid, message);
            dispatched = true;
        } catch (Exception e) {
            logger.log(Level.WARNING, "NMS chat başarısız: " + e.getMessage());
        }

        // İptal semantiği: plugin chat'i engellediyse cancelled=true
        recordEvent("player.chat", actorId, actorUuid, Map.of(
                "actor_id", actorId,
                "message", message,
                "cancelled", cancelled,
                "dispatched", dispatched));

        // Message capture (M2B): player.message, listener'dan bağımsız olarak
        // aynı semantiği taşır — assertion'lar tek deterministik kaynaktan okur.
        recordEvent("player.message", actorId, actorUuid, Map.of(
                "actor_id", actorId,
                "message", message,
                "cancelled", cancelled,
                "dispatched", dispatched));

        logger.info("Test actor " + actorId + " mesaj gonderdi: " + message
                + " (cancelled=" + cancelled + ")");

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("actor_id", actorId);
        result.put("cancelled", cancelled);
        result.put("message", cancelled
                ? "Mesaj gonderme islemi basarili (event iptal edildi)."
                : "Mesaj gonderme islemi basarili.");
        return result;
    }

    /**
     * Gerçek {@link AsyncPlayerChatEvent} fırlatır.
     *
     * <p>Plugin listener'ları (message capture dahil) tetiklenir.
     * Event iptal edilirse {@code true} döner.
     *
     * @return event iptal edildi ise {@code true}
     */
    private boolean chatNms(UUID actorUuid, String message) throws Exception {
        Player player = server.getPlayer(actorUuid);
        if (player == null) {
            return false;
        }

        // Chat event'i fırlat
        AsyncPlayerChatEvent chatEvent = new AsyncPlayerChatEvent(
                false, player, message, new java.util.HashSet<>());
        server.getPluginManager().callEvent(chatEvent);

        logger.info(() -> "NMS chat event fırlatıldı: " + message);
        return chatEvent.isCancelled();
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

        // Native permission: dispatchCommand oyuncu permission'ı ile işlenir;
        // yetkisiz komutlarda false döner (geçen ama yanlış test engellenir).
        boolean dispatchOk = false;
        String dispatchNote = null;
        try {
            dispatchOk = pluginCommandNms(actorUuid, fullCommand);
        } catch (Exception e) {
            logger.log(Level.WARNING, "NMS plugin command başarısız: " + e.getMessage());
            dispatchNote = e.getMessage();
        }

        recordEvent("player.command", actorId, actorUuid, Map.of(
                "actor_id", actorId,
                "command", fullCommand,
                "dispatch_ok", dispatchOk));

        logger.info("Test actor " + actorId + " komut calistirdi: " + fullCommand
                + " (dispatch_ok=" + dispatchOk + ")");

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("actor_id", actorId);
        result.put("command", fullCommand);
        result.put("dispatch_ok", dispatchOk);
        result.put("message", dispatchOk
                ? "Komut calistirma islemi basarili."
                : "Komut oyuncu permission'ı ile reddedildi.");
        return result;
    }

    /**
     * Komutu oyuncu bağlamında çalıştırır.
     *
     * <p>Native permission semantiği: {@code server.dispatchCommand(player, cmd)}
     * oyuncunun izinlerine göre komutu işler; yetki yoksa {@code false} döner.
     *
     * @return komut dispatch edildi ise {@code true}
     */
    private boolean pluginCommandNms(UUID actorUuid, String command) throws Exception {
        Player player = server.getPlayer(actorUuid);
        if (player == null) {
            return false;
        }

        // Komutu oyuncu olarak çalıştır
        return server.dispatchCommand(player, command);
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

    /**
     * Actor'ın gerçekten online olup olmadığını söyler.
     */
    public boolean isActorOnline(String actorId) {
        UUID actorUuid = activeActors.get(actorId);
        return actorUuid != null && server.getPlayer(actorUuid) != null;
    }

    private void recordEvent(String type, String actorId, UUID actorUuid, Map<String, Object> data) {
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
                actorId == null ? null : "test_actor",
                actorId,
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
