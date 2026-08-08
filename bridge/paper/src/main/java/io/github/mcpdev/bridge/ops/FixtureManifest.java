package io.github.mcpdev.bridge.ops;

import io.github.mcpdev.bridge.http.JsonReader;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Fixture manifest'i — dünya mutation'larının bölge ve materyal sınırlarını
 * taşır (contracts/determinism.md).
 *
 * <p>Supervisor, fixture manifest YAML'ını runtime hazırlarken
 * {@code mcpdev-fixture.json} olarak runtime köküne yazar; Bridge bu dosyayı
 * JSON olarak okur. YAML parser Bridge'e bilinçli olarak girmez
 * (supply-chain yüzeyi, bkz. {@link io.github.mcpdev.bridge.http.Json}).
 *
 * <p>Bu sınıf Bukkit'ten arındırılmıştır: bölge ve materyal doğrulaması gerçek
 * bir Minecraft sunucusu olmadan test edilebilir.
 */
public final class FixtureManifest {

    /** world.set_block ve world.set_chunk_ticket'in çalıştığı sabit bölge adı. */
    public static final String FIXTURE_REGION = "fixture-area";

    public record Region(String worldKey, int minX, int minY, int minZ, int maxX, int maxY, int maxZ) {

        /** Blok koordinatı (y dahil) bölgenin içinde mi? */
        public boolean contains(int x, int y, int z) {
            return x >= minX && x <= maxX && y >= minY && y <= maxY && z >= minZ && z <= maxZ;
        }

        /** Blok koordinatı (y hariç — chunk ticket dikey ekseni kapsamaz) bölgenin içinde mi? */
        public boolean containsColumn(int x, int z) {
            return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
        }
    }

    private final Map<String, Region> regions;
    private final List<String> allowedMaterials;

    private FixtureManifest(Map<String, Region> regions, List<String> allowedMaterials) {
        this.regions = regions;
        this.allowedMaterials = allowedMaterials;
    }

    public Optional<Region> region(String name) {
        return Optional.ofNullable(regions.get(name));
    }

    public boolean isAllowedMaterial(String material) {
        return allowedMaterials.contains(material);
    }

    /**
     * JSON metinden manifest çözer.
     *
     * @throws BridgeOperationException manifest yoksa veya biçimi geçersizse
     */
    public static FixtureManifest parse(String json) {
        Map<String, Object> root;
        try {
            root = JsonReader.readObject(json);
        } catch (JsonReader.JsonParseException e) {
            throw BridgeOperationException.regionNotAllowed("Fixture manifest'i geçersiz JSON: " + e.getMessage());
        }

        Map<String, Region> regions = new LinkedHashMap<>();
        Object rawRegions = root.get("regions");
        if (rawRegions instanceof Map<?, ?> regionMap) {
            for (Map.Entry<?, ?> entry : regionMap.entrySet()) {
                String name = String.valueOf(entry.getKey());
                if (entry.getValue() instanceof Map<?, ?> region) {
                    regions.put(name, parseRegion(name, region));
                }
            }
        }

        List<String> materials = new java.util.ArrayList<>();
        Object rawMaterials = root.get("allowed_materials");
        if (rawMaterials instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof String s) {
                    materials.add(s);
                }
            }
        }

        return new FixtureManifest(regions, materials);
    }

    private static Region parseRegion(String name, Map<?, ?> region) {
        try {
            String worldKey = String.valueOf(region.get("world_key"));
            @SuppressWarnings("unchecked")
            Map<String, Object> min = (Map<String, Object>) region.get("min");
            @SuppressWarnings("unchecked")
            Map<String, Object> max = (Map<String, Object>) region.get("max");
            return new Region(
                    worldKey,
                    toInt(min.get("x")), toInt(min.get("y")), toInt(min.get("z")),
                    toInt(max.get("x")), toInt(max.get("y")), toInt(max.get("z")));
        } catch (RuntimeException e) {
            throw BridgeOperationException.regionNotAllowed(
                    "Fixture manifest'i bölge geçersiz: " + name + " (" + e.getMessage() + ")");
        }
    }

    private static int toInt(Object value) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        throw new IllegalArgumentException("tam sayı koordinat bekleniyordu");
    }
}
