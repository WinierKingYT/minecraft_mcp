package io.github.mcpdev.bridge.scheduler;

import java.io.Serial;

/** Error catalog: {@code BRIDGE_TIMEOUT} (HTTP 504). */
public final class BridgeTimeoutException extends RuntimeException {

    @Serial
    private static final long serialVersionUID = 1L;

    public static final String CODE = "BRIDGE_TIMEOUT";
    public static final int HTTP_STATUS = 504;

    private final boolean taskCancelled;

    public BridgeTimeoutException(String message, boolean taskCancelled) {
        super(message);
        this.taskCancelled = taskCancelled;
    }

    /**
     * Görevin gerçekten iptal edilip edilmediği.
     *
     * <p>{@code false} ise ana thread'de hâlâ çalışan bir görev olabilir; bu
     * durum mutation'lar için {@code UNKNOWN_OUTCOME} anlamına gelir ve kör
     * retry yasaktır.
     */
    public boolean taskCancelled() {
        return taskCancelled;
    }
}
