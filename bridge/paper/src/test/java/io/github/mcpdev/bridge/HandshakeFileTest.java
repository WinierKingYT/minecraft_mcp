package io.github.mcpdev.bridge;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** CT-BRIDGE-HANDSHAKE-001 — handshake dosyası secret taşımaz. */
class HandshakeFileTest {

    @Test
    void handshakeContainsPortButNoSecret(@TempDir Path root) throws IOException {
        BridgeBoot boot = BridgeBoot.create();
        Path file = HandshakeFile.write(root, boot, 54321, "srv_test");

        String content = Files.readString(file);

        assertTrue(content.contains("\"port\":54321"));
        assertTrue(content.contains(boot.bootId()));
        assertTrue(content.contains("\"bridge_protocol\":1"));
        assertTrue(content.contains("\"bind_address\":\"127.0.0.1\""));

        // BR-05: handshake dosyası tanım gereği okunabilirdir; token'ı buraya
        // koymak "bağlantı bilgisi" ile "yetki"yi birleştirirdi.
        String lower = content.toLowerCase(java.util.Locale.ROOT);
        assertFalse(lower.contains("token"), "handshake dosyası token içermemeli: " + content);
        assertFalse(lower.contains("secret"), "handshake dosyası secret içermemeli: " + content);
        assertFalse(lower.contains("authorization"), "handshake dosyası authorization içermemeli: " + content);
    }

    @Test
    void deleteRemovesHandshake(@TempDir Path root) throws IOException {
        BridgeBoot boot = BridgeBoot.create();
        HandshakeFile.write(root, boot, 1234, "srv_test");
        assertTrue(Files.exists(root.resolve(HandshakeFile.FILE_NAME)));

        HandshakeFile.delete(root);

        // Kalan bir handshake dosyası, Supervisor'ın ölü bir porta bağlanmayı
        // denemesine yol açar.
        assertFalse(Files.exists(root.resolve(HandshakeFile.FILE_NAME)));
    }

    @Test
    void deleteIsIdempotent(@TempDir Path root) throws IOException {
        HandshakeFile.delete(root);
        HandshakeFile.delete(root);
    }

    @Test
    void writeIsAtomicAndLeavesNoPartialFile(@TempDir Path root) throws IOException {
        BridgeBoot boot = BridgeBoot.create();
        HandshakeFile.write(root, boot, 999, "srv_test");

        assertFalse(
                Files.exists(root.resolve(HandshakeFile.FILE_NAME + ".part")),
                "geçici dosya rename sonrası kalmamalı");
    }
}
