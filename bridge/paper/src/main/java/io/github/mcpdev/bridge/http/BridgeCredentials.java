package io.github.mcpdev.bridge.http;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Objects;

/**
 * Bridge token'ı.
 *
 * <p><strong>Secret handshake dosyasında BULUNMAZ</strong> (docs/contracts/bridge.md BR-05).
 * Akış şöyledir:
 *
 * <ol>
 *   <li>Supervisor her runtime için rastgele bir token üretir.</li>
 *   <li>Token'ı runtime kökündeki dar izinli bir dosyaya yazar.</li>
 *   <li>Bridge açılışta bu dosyadan okur.</li>
 *   <li>Bridge handshake dosyasına yalnızca port ve protokol metadata'sı yazar.</li>
 * </ol>
 *
 * <p>Token'ı handshake dosyasına koymak, "bağlantı bilgisi" ile "yetki"yi aynı
 * dosyada birleştirirdi; handshake dosyası tanım gereği okunabilir olmak
 * zorundadır.
 *
 * <p><strong>Sınır (ADR-0007):</strong> Aynı JVM'deki hedef plugin bu dosyayı
 * okuyabilir. Bu belgelenmiş bir limitationdır, hata değildir.
 */
public final class BridgeCredentials {

    private final byte[] token;

    private BridgeCredentials(byte[] token) {
        this.token = token;
    }

    public static BridgeCredentials fromFile(Path tokenFile) throws IOException {
        byte[] raw = Files.readAllBytes(tokenFile);
        String trimmed = new String(raw, StandardCharsets.UTF_8).trim();
        if (trimmed.length() < 32) {
            throw new IOException("Bridge token dosyası çok kısa; en az 32 karakter bekleniyor.");
        }
        return new BridgeCredentials(trimmed.getBytes(StandardCharsets.UTF_8));
    }

    public static BridgeCredentials of(String token) {
        return new BridgeCredentials(Objects.requireNonNull(token, "token").getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Sabit süreli karşılaştırma.
     *
     * <p>{@code String.equals} ilk farklı baytta döner ve token uzunluğu/önekini
     * zamanlama üzerinden sızdırır. Loopback üzerinde bile ölçülebilir olduğu
     * için kullanılmaz (CT-BRIDGE-AUTH-001).
     */
    public boolean matches(String presented) {
        if (presented == null) {
            return false;
        }
        return MessageDigest.isEqual(token, presented.getBytes(StandardCharsets.UTF_8));
    }

    /** Authorization başlığından Bearer değerini çıkarır; yoksa {@code null}. */
    public static String extractBearer(String authorizationHeader) {
        if (authorizationHeader == null) {
            return null;
        }
        String prefix = "Bearer ";
        if (authorizationHeader.length() <= prefix.length()) {
            return null;
        }
        if (!authorizationHeader.regionMatches(true, 0, prefix, 0, prefix.length())) {
            return null;
        }
        return authorizationHeader.substring(prefix.length()).trim();
    }
}
