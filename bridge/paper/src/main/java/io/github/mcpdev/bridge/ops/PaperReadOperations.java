package io.github.mcpdev.bridge.ops;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/**
 * {@link ReadOperations} için Bukkit implementasyonu.
 *
 * <p>Bukkit'e dokunan tek sınıf budur; dispatch ve doğrulama mantığı
 * {@link QueryDispatcher} içinde ve Bukkit'ten bağımsızdır.
 *
 * <p>Tüm metotlar ana thread'de çağrılır ({@code MainThreadExecutor}).
 *
 * <p><strong>Kişisel veri taşımaz:</strong> oyuncu yanıtları IP veya gerçek
 * hesap kimliği içermez; yalnızca test actor adı döner (EV-05).
 */
public final class PaperReadOperations implements ReadOperations {

    private final Server server;

    public PaperReadOperations(Server server) {
        this.server = server;
    }

    @Override
    public Map<String, Object> serverState() {
        Map<String, Object> state = new LinkedHashMap<>();
        state.put("paper_version", Bukkit.getMinecraftVersion());
        state.put("server_version", server.getVersion());
        state.put("java_version", Runtime.version().feature());
        state.put("online_players", server.getOnlinePlayers().size());
        state.put("max_players", server.getMaxPlayers());
        state.put("world_count", server.getWorlds().size());
        state.put("current_tick", server.getCurrentTick());

        double[] tps = server.getTPS();
        state.put("tps_1m", tps.length > 0 ? round(tps[0]) : null);
        state.put("mspt", round(server.getAverageTickTime()));
        return state;
    }

    @Override
    public Map<String, Object> pluginList() {
        List<Map<String, Object>> plugins = new ArrayList<>();
        for (Plugin plugin : server.getPluginManager().getPlugins()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("name", plugin.getName());
            entry.put("version", plugin.getPluginMeta().getVersion());
            entry.put("enabled", plugin.isEnabled());
            plugins.add(entry);
        }
        plugins.sort((a, b) -> String.valueOf(a.get("name")).compareTo(String.valueOf(b.get("name"))));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("count", plugins.size());
        result.put("plugins", plugins);
        return result;
    }

    @Override
    public Map<String, Object> pluginGet(String pluginName) {
        Plugin plugin = server.getPluginManager().getPlugin(pluginName);
        if (plugin == null) {
            throw BridgeOperationException.pluginNotFound(pluginName);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("name", plugin.getName());
        result.put("version", plugin.getPluginMeta().getVersion());
        result.put("enabled", plugin.isEnabled());
        result.put("api_version", plugin.getPluginMeta().getAPIVersion());
        result.put("main_class", plugin.getPluginMeta().getMainClass());
        result.put("depend", List.copyOf(plugin.getPluginMeta().getPluginDependencies()));
        result.put("soft_depend", List.copyOf(plugin.getPluginMeta().getPluginSoftDependencies()));
        return result;
    }

    @Override
    public Map<String, Object> worldList() {
        List<Map<String, Object>> worlds = new ArrayList<>();
        for (World world : server.getWorlds()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("world_key", world.getKey().toString());
            entry.put("name", world.getName());
            entry.put("environment", world.getEnvironment().name());
            entry.put("loaded_chunks", world.getLoadedChunks().length);
            entry.put("time", world.getTime());

            // Spawn koordinatları ve o chunk'ın yüklü olup olmadığı bildirilir:
            // world.get_block chunk YÜKLETMEZ, bu yüzden çağıranın hangi
            // konumun okunabilir olduğunu önceden bilmesi gerekir.
            var spawn = world.getSpawnLocation();
            entry.put("spawn_x", spawn.getBlockX());
            entry.put("spawn_y", spawn.getBlockY());
            entry.put("spawn_z", spawn.getBlockZ());
            entry.put("spawn_chunk_loaded", world.isChunkLoaded(spawn.getBlockX() >> 4, spawn.getBlockZ() >> 4));
            worlds.add(entry);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("count", worlds.size());
        result.put("worlds", worlds);
        return result;
    }

    @Override
    public Map<String, Object> worldGetBlock(String worldKey, int x, int y, int z) {
        World world = resolveWorld(worldKey);

        // Chunk yükletmeyiz: bir okuma isteği dünya üretimini tetiklerse hem
        // yavaşlar hem de "salt okuma" iddiası bozulur.
        if (!world.isChunkLoaded(x >> 4, z >> 4)) {
            throw BridgeOperationException.chunkNotLoaded(x >> 4, z >> 4);
        }

        Block block = world.getBlockAt(x, y, z);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("world_key", world.getKey().toString());
        result.put("x", x);
        result.put("y", y);
        result.put("z", z);
        result.put("material", block.getType().getKey().toString());
        return result;
    }

    @Override
    public Map<String, Object> playerState(String playerId) {
        Player player = server.getPlayerExact(playerId);
        if (player == null) {
            throw new BridgeOperationException("PLAYER_NOT_FOUND", 404, "Oyuncu bağlı değil: " + playerId);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        // IP, UUID veya gerçek hesap kimliği BİLİNÇLİ olarak yok (EV-05).
        result.put("id", player.getName());
        result.put("world_key", player.getWorld().getKey().toString());
        result.put("x", player.getLocation().getBlockX());
        result.put("y", player.getLocation().getBlockY());
        result.put("z", player.getLocation().getBlockZ());
        result.put("health", round(player.getHealth()));
        result.put("gamemode", player.getGameMode().name());
        return result;
    }

    private World resolveWorld(String worldKey) {
        NamespacedKey key;
        try {
            key = NamespacedKey.fromString(worldKey);
        } catch (IllegalArgumentException e) {
            throw BridgeOperationException.worldNotFound(worldKey);
        }
        if (key == null) {
            throw BridgeOperationException.worldNotFound(worldKey);
        }
        World world = server.getWorld(key);
        if (world == null) {
            throw BridgeOperationException.worldNotFound(worldKey);
        }
        return world;
    }

    private static Double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
