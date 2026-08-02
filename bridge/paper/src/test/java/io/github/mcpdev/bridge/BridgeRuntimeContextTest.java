package io.github.mcpdev.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * ST-BRIDGE-INERT-001 — Bridge, yönetilen runtime dışında kontrol yüzeyi açmaz.
 *
 * <p>Bu testler bir güvenlik davranışını kilitler: Bridge JAR'ı sıradan bir
 * Paper sunucusuna atıldığında kimlik doğrulamalı bir HTTP yüzeyini
 * kendiliğinden açmamalıdır.
 */
class BridgeRuntimeContextTest {

    private static void prepare(Path root, boolean marker, boolean token) throws IOException {
        if (marker) {
            Files.writeString(root.resolve(BridgeRuntimeContext.MARKER_FILE), "runtime");
        }
        if (token) {
            Files.writeString(root.resolve(BridgeRuntimeContext.TOKEN_FILE), "0".repeat(32));
        }
    }

    @Test
    void detectsFullyPreparedRuntime(@TempDir Path root) throws IOException {
        prepare(root, true, true);

        Optional<BridgeRuntimeContext> ctx = BridgeRuntimeContext.detect(root.toString(), "srv_test");

        assertTrue(ctx.isPresent());
        assertEquals("srv_test", ctx.get().serverInstanceId());
        assertEquals(root.toAbsolutePath().normalize(), ctx.get().runtimeRoot());
    }

    @Test
    void withoutSystemPropertyBridgeStaysInert(@TempDir Path root) throws IOException {
        prepare(root, true, true);

        assertTrue(BridgeRuntimeContext.detect(null, "srv_test").isEmpty());
        assertTrue(BridgeRuntimeContext.detect("  ", "srv_test").isEmpty());
    }

    @Test
    void withoutServerInstanceIdBridgeStaysInert(@TempDir Path root) throws IOException {
        prepare(root, true, true);

        assertTrue(BridgeRuntimeContext.detect(root.toString(), null).isEmpty());
        assertTrue(BridgeRuntimeContext.detect(root.toString(), "").isEmpty());
    }

    @Test
    void withoutMarkerFileBridgeStaysInert(@TempDir Path root) throws IOException {
        // Marker yoksa bu dizinin bize ait olduğunu varsayamayız
        // (security/controls.md FS-05).
        prepare(root, false, true);

        assertTrue(BridgeRuntimeContext.detect(root.toString(), "srv_test").isEmpty());
    }

    @Test
    void withoutTokenFileBridgeStaysInert(@TempDir Path root) throws IOException {
        prepare(root, true, false);

        assertTrue(BridgeRuntimeContext.detect(root.toString(), "srv_test").isEmpty());
    }

    @Test
    void nonExistentRootIsRejected(@TempDir Path root) {
        assertTrue(BridgeRuntimeContext.detect(root.resolve("yok").toString(), "srv_test").isEmpty());
    }
}
