package io.github.mcpdev.bridge.ops;

import io.github.mcpdev.bridge.scheduler.MainThreadExecutor;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.block.Block;

/**
 * {@link WorldMutations} için Bukkit implementasyonu.
 *
 * <p>Fixture manifest'i runtime kökündeki {@code mcpdev-fixture.json}'dan
 * okunur; dosya yoksa dünya mutation'ları REGION_NOT_ALLOWED ile reddedilir.
 * Manifest okuma işlemi ilk çağrıda yapılır ve önbelleğe alınır.
 *
 * <p>Tüm metotlar ana thread'de çalıştırılır ({@code MainThreadExecutor}).
 */
public final class PaperWorldMutations implements WorldMutations {

    public static final String MANIFEST_FILE = "mcpdev-fixture.json";
    private static final Duration OPERATION_TIMEOUT = Duration.ofMillis(2000);

    private final Server server;
    private final Path runtimeRoot;
    private final MainThreadExecutor executor;

    private volatile FixtureManifest manifest;

    public PaperWorldMutations(Server server, Path runtimeRoot, MainThreadExecutor executor) {
        this.server = server;
        this.runtimeRoot = runtimeRoot;
        this.executor = executor;
    }

    @Override
    public Map<String, Object> setBlock(String worldKey, int x, int y, int z, String material) {
        return executor.call(() -> doSetBlock(worldKey, x, y, z, material), OPERATION_TIMEOUT);
    }

    @Override
    public Map<String, Object> setChunkTicket(String worldKey, int x, int z, int radius) {
        return executor.call(() -> doSetChunkTicket(worldKey, x, z, radius), OPERATION_TIMEOUT);
    }

    private Map<String, Object> doSetBlock(String worldKey, int x, int y, int z, String material) {
        FixtureManifest manifest = manifest();
        FixtureManifest.Region region = manifest.region(FixtureManifest.FIXTURE_REGION)
                .orElseThrow(() -> BridgeOperationException.regionNotAllowed(
                        "Fixture manifest'i '" + FixtureManifest.FIXTURE_REGION + "' bölgesini tanımlamıyor."));

        if (!region.worldKey().equals(worldKey) || !region.contains(x, y, z)) {
            throw BridgeOperationException.regionNotAllowed(
                    "Bölge dışı yazma reddedildi: " + worldKey + " " + x + "," + y + "," + z
                            + " (bölge: " + FixtureManifest.FIXTURE_REGION + ")");
        }
        if (!manifest.isAllowedMaterial(material)) {
            throw BridgeOperationException.materialNotAllowed(
                    "İzin verilmeyen materyal: " + material);
        }

        World world = resolveWorld(worldKey);
        if (!world.isChunkLoaded(x >> 4, z >> 4)) {
            throw BridgeOperationException.chunkNotLoaded(x >> 4, z >> 4);
        }

        Material type = Material.matchMaterial(material);
        if (type == null || !type.isBlock()) {
            throw BridgeOperationException.invalidArguments(
                    "Geçersiz blok materyali: " + material);
        }

        Block block = world.getBlockAt(x, y, z);
        block.setType(type, false);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("world_key", world.getKey().toString());
        result.put("x", x);
        result.put("y", y);
        result.put("z", z);
        result.put("material", block.getType().getKey().toString());
        return result;
    }

    private Map<String, Object> doSetChunkTicket(String worldKey, int x, int z, int radius) {
        FixtureManifest manifest = manifest();
        FixtureManifest.Region region = manifest.region(FixtureManifest.FIXTURE_REGION)
                .orElseThrow(() -> BridgeOperationException.regionNotAllowed(
                        "Fixture manifest'i '" + FixtureManifest.FIXTURE_REGION + "' bölgesini tanımlamıyor."));

        if (!region.worldKey().equals(worldKey) || !region.containsColumn(x, z)) {
            throw BridgeOperationException.regionNotAllowed(
                    "Bölge dışı ticket reddedildi: " + worldKey + " " + x + "," + z
                            + " (bölge: " + FixtureManifest.FIXTURE_REGION + ")");
        }
        if (radius < 1 || radius > 4) {
            throw BridgeOperationException.invalidArguments(
                    "radius 1 ile 4 arasında olmalıdır.");
        }

        World world = resolveWorld(worldKey);
        int chunkX = x >> 4;
        int chunkZ = z >> 4;

        int forced = 0;
        for (int dx = -radius; dx <= radius; dx++) {
            for (int dz = -radius; dz <= radius; dz++) {
                int cx = chunkX + dx;
                int cz = chunkZ + dz;
                world.loadChunk(cx, cz, true);
                world.setChunkForceLoaded(cx, cz, true);
                forced++;
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("world_key", world.getKey().toString());
        result.put("chunk_x", chunkX);
        result.put("chunk_z", chunkZ);
        result.put("radius", radius);
        result.put("forced_chunks", forced);
        return result;
    }

    private FixtureManifest manifest() {
        FixtureManifest cached = manifest;
        if (cached != null) {
            return cached;
        }
        Path file = runtimeRoot.resolve(MANIFEST_FILE);
        if (!Files.isRegularFile(file)) {
            throw BridgeOperationException.regionNotAllowed(
                    "Fixture manifest'i yok: " + file + " — dünya mutation'ları devre dışı.");
        }
        try {
            String json = Files.readString(file, StandardCharsets.UTF_8);
            FixtureManifest parsed = FixtureManifest.parse(json);
            manifest = parsed;
            return parsed;
        } catch (IOException e) {
            throw BridgeOperationException.regionNotAllowed(
                    "Fixture manifest'i okunamadı: " + e.getMessage());
        }
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
}
