package io.github.mcpdev.bridge.ops;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * CT-WORLD-TICKET-001 — fixture manifest çözümleme ve bölge/materyal doğrulaması.
 *
 * <p>Gerçek Paper GEREKTİRMEZ: yalnızca JSON çözümleme + saf doğrulama.
 */
class FixtureManifestTest {

    private static final String MANIFEST = """
            {
              "fixture_id": "flat-world-v1",
              "world_seed": "123456789",
              "regions": {
                "fixture-area": {
                  "world_key": "minecraft:overworld",
                  "min": { "x": -64, "y": -64, "z": -64 },
                  "max": { "x": 64, "y": 320, "z": 64 }
                }
              },
              "allowed_materials": ["minecraft:air", "minecraft:stone", "minecraft:dirt"]
            }
            """;

    @Test
    void manifestCozulurVeBolgeIceriDisariDogruAyirtEdilir() {
        FixtureManifest manifest = FixtureManifest.parse(MANIFEST);

        FixtureManifest.Region region = manifest.region("fixture-area").orElseThrow();
        assertEquals("minecraft:overworld", region.worldKey());
        assertTrue(region.contains(10, 64, 10));
        assertTrue(region.contains(64, 320, 64));
        assertFalse(region.contains(65, 64, 10));
        assertFalse(region.contains(10, -65, 10));
        assertFalse(region.contains(0, 64, 65));
        assertTrue(region.containsColumn(64, 10));
        assertFalse(region.containsColumn(65, 10));
    }

    @Test
    void materyalAllowlistDogruCalisir() {
        FixtureManifest manifest = FixtureManifest.parse(MANIFEST);

        assertTrue(manifest.isAllowedMaterial("minecraft:stone"));
        assertTrue(manifest.isAllowedMaterial("minecraft:dirt"));
        assertFalse(manifest.isAllowedMaterial("minecraft:bedrock"));
    }

    @Test
    void eksikBolgeNotFoundDegerilir() {
        FixtureManifest manifest = FixtureManifest.parse(MANIFEST);
        assertTrue(manifest.region("baska-bolge").isEmpty());
    }

    @Test
    void gecersizJsonRegionNotAllowedUretir() {
        BridgeOperationException err = assertThrows(BridgeOperationException.class, () ->
                FixtureManifest.parse("{ bu bir json degil"));
        assertEquals("REGION_NOT_ALLOWED", err.code());
    }
}
