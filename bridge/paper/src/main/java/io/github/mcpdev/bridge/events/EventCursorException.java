package io.github.mcpdev.bridge.events;

import java.io.Serial;

/**
 * Cursor geçersiz.
 *
 * <p>Bu istisnanın var olma nedeni, sessiz başa sarmayı imkânsız kılmaktır:
 * kaçırılan event'leri görünmez kılan bir tasarım, geçen fakat yanlış
 * assertion'lar üretir — başarısız testten daha tehlikelidir.
 */
public final class EventCursorException extends RuntimeException {

    @Serial
    private static final long serialVersionUID = 1L;

    /** Error catalog karşılıkları. */
    public enum Kind {
        INSTANCE_MISMATCH("EVENT_CURSOR_INSTANCE_MISMATCH", 409),
        EXPIRED("EVENT_CURSOR_EXPIRED", 409);

        private final String code;
        private final int httpStatus;

        Kind(String code, int httpStatus) {
            this.code = code;
            this.httpStatus = httpStatus;
        }

        public String code() {
            return code;
        }

        public int httpStatus() {
            return httpStatus;
        }
    }

    private final transient Kind kind;

    public EventCursorException(Kind kind, String message) {
        super(message);
        this.kind = kind;
    }

    public Kind kind() {
        return kind;
    }
}
