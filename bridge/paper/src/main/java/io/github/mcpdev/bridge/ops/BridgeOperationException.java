package io.github.mcpdev.bridge.ops;

import java.io.Serial;

/** Error catalog'daki bir koda karşılık gelen operation hatası. */
public final class BridgeOperationException extends RuntimeException {

    @Serial
    private static final long serialVersionUID = 1L;

    private final String code;
    private final int httpStatus;

    public BridgeOperationException(String code, int httpStatus, String message) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
    }

    public static BridgeOperationException worldNotFound(String worldKey) {
        return new BridgeOperationException(
                "WORLD_NOT_FOUND", 404, "Dünya yüklü değil: " + worldKey);
    }

    public static BridgeOperationException pluginNotFound(String name) {
        return new BridgeOperationException(
                "PLUGIN_NOT_FOUND", 404, "Plugin runtime'da yüklü değil: " + name);
    }

    public static BridgeOperationException chunkNotLoaded(int x, int z) {
        return new BridgeOperationException(
                "CHUNK_NOT_LOADED", 409, "Hedef chunk yüklü değil: " + x + "," + z);
    }

    public static BridgeOperationException regionNotAllowed(String detail) {
        return new BridgeOperationException("REGION_NOT_ALLOWED", 403, detail);
    }

    public static BridgeOperationException capabilityUnavailable(String operation) {
        return new BridgeOperationException(
                "CAPABILITY_UNAVAILABLE", 501, "Operation bu Bridge sürümünde uygulanmadı: " + operation);
    }

    public static BridgeOperationException invalidArguments(String detail) {
        return new BridgeOperationException("TOOL_INPUT_INVALID", 400, detail);
    }

    public String code() {
        return code;
    }

    public int httpStatus() {
        return httpStatus;
    }
}
