package io.github.mcpdev.bridge;

import io.github.mcpdev.bridge.http.Json;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Bridge handshake dosyası.
 *
 * <p>Supervisor, Bridge'in hangi porta bağlandığını buradan öğrenir.
 *
 * <p><strong>Secret İÇERMEZ</strong> (docs/contracts/bridge.md BR-05). Handshake
 * dosyası tanım gereği okunabilir olmak zorundadır; token'ı buraya koymak
 * "bağlantı bilgisi" ile "yetki"yi aynı okunabilir dosyada birleştirirdi.
 *
 * <p>Yazma atomiktir (temp + rename): Supervisor yarım yazılmış bir dosya
 * okuyup port'u yanlış çözemez.
 */
public final class HandshakeFile {

    public static final String FILE_NAME = "bridge-handshake.json";

    private HandshakeFile() {
    }

    public static Path write(Path runtimeRoot, BridgeBoot boot, int port, String serverInstanceId)
            throws IOException {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("bridge_protocol", BridgeBoot.PROTOCOL_VERSION);
        fields.put("bridge_boot_id", boot.bootId());
        fields.put("server_instance_id", serverInstanceId);
        fields.put("bind_address", "127.0.0.1");
        fields.put("port", port);
        fields.put("started_at_millis", boot.startedAtMillis());
        // Bilinçli olarak yok: token, secret, mutlak yol.

        Path target = runtimeRoot.resolve(FILE_NAME);
        Path temp = runtimeRoot.resolve(FILE_NAME + ".part");

        Files.writeString(temp, Json.object(fields), StandardCharsets.UTF_8);
        Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        return target;
    }

    /**
     * Kapanışta handshake dosyası silinir. Kalan bir dosya, Supervisor'ın artık
     * dinlemeyen bir porta bağlanmayı denemesine yol açar.
     */
    public static void delete(Path runtimeRoot) throws IOException {
        Files.deleteIfExists(runtimeRoot.resolve(FILE_NAME));
    }
}
