package io.github.mcpdev.bridge;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

/**
 * Bridge'in yönetilen bir runtime içinde çalışıp çalışmadığını belirler.
 *
 * <p>Supervisor, Paper'ı başlatırken şu sistem özelliklerini geçer:
 *
 * <pre>
 *   -Dmcpdev.runtime.root=&lt;runtime kökü&gt;
 *   -Dmcpdev.server.instance.id=srv_...
 * </pre>
 *
 * <p><strong>Bunlar yoksa Bridge HTTP sunucusunu BAŞLATMAZ.</strong> Bu bilinçli
 * bir güvenlik davranışıdır: Bridge JAR'ı yanlışlıkla (veya kötü niyetle)
 * sıradan bir Paper sunucusuna atıldığında, kimlik doğrulamalı bir kontrol
 * yüzeyini kendiliğinden açmamalıdır. Yönetilen runtime dışında Bridge
 * yalnızca sürüm bilgisi loglar ve atıl kalır.
 *
 * <p>Ayrıca runtime marker dosyası aranır: Supervisor'ın gerçekten bu dizini
 * oluşturduğunun kanıtıdır (security/controls.md FS-05).
 */
public record BridgeRuntimeContext(Path runtimeRoot, Path tokenFile, String serverInstanceId) {

    public static final String RUNTIME_ROOT_PROPERTY = "mcpdev.runtime.root";
    public static final String SERVER_INSTANCE_PROPERTY = "mcpdev.server.instance.id";
    public static final String MARKER_FILE = ".mcpdev-runtime";
    public static final String TOKEN_FILE = "bridge-token";

    /** Yönetilen runtime tespit edilirse bağlam, aksi hâlde boş. */
    public static Optional<BridgeRuntimeContext> detect() {
        return detect(System.getProperty(RUNTIME_ROOT_PROPERTY), System.getProperty(SERVER_INSTANCE_PROPERTY));
    }

    static Optional<BridgeRuntimeContext> detect(String rootProperty, String serverInstanceId) {
        if (rootProperty == null || rootProperty.isBlank()) {
            return Optional.empty();
        }
        if (serverInstanceId == null || serverInstanceId.isBlank()) {
            return Optional.empty();
        }

        Path root = Path.of(rootProperty).toAbsolutePath().normalize();
        if (!Files.isDirectory(root)) {
            return Optional.empty();
        }
        // Marker olmadan bu dizinin bize ait olduğunu varsayamayız.
        if (!Files.isRegularFile(root.resolve(MARKER_FILE))) {
            return Optional.empty();
        }

        Path token = root.resolve(TOKEN_FILE);
        if (!Files.isRegularFile(token)) {
            return Optional.empty();
        }

        return Optional.of(new BridgeRuntimeContext(root, token, serverInstanceId));
    }
}
