package io.github.mcpdev.bridge.http;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.github.mcpdev.bridge.events.EventCursorException;
import io.github.mcpdev.bridge.ops.BridgeOperationException;
import io.github.mcpdev.bridge.scheduler.BridgeTimeoutException;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

/**
 * Bridge loopback HTTP sunucusu.
 *
 * <p>docs/contracts/bridge.md BR-01..BR-09:
 *
 * <ul>
 *   <li>Yalnızca loopback'e bind edilir — dış arayüze asla.</li>
 *   <li>Port rastgele seçilir (port 0).</li>
 *   <li>Her istek Bearer token ile doğrulanır; karşılaştırma sabit sürelidir.</li>
 *   <li>Host başlığı loopback olmalıdır; Origin başlığı bulunmamalıdır
 *       (tarayıcı kaynaklı istek = DNS rebinding girişimi).</li>
 *   <li>Worker havuzu ve kuyruğu sınırlıdır; dolduğunda BRIDGE_BUSY.</li>
 *   <li>Gövde boyutu sınırlıdır.</li>
 * </ul>
 *
 * <p><strong>Sınır (ADR-0007):</strong> Bu kontroller rastgele localhost
 * process'lerine ve tarayıcı kaynaklı isteklere karşı korur. Aynı Paper JVM'i
 * içindeki aktif kötü niyetli hedef plugin'e karşı güvenlik sınırı
 * <em>değildir</em>.
 *
 * <p>Bukkit API'sine bağımlılığı yoktur; bu sayede gerçek Paper olmadan
 * sözleşme testleriyle sınanabilir.
 */
public final class BridgeHttpServer implements AutoCloseable {

    /** docs/contracts/config.md security.max_request_body_bytes varsayılanı. */
    public static final int MAX_REQUEST_BODY_BYTES = 262_144;

    /** docs/contracts/config.md security.max_event_results varsayılanı. */
    public static final int MAX_EVENT_RESULTS = 1000;

    private static final int WORKER_THREADS = 4;
    private static final int QUEUE_CAPACITY = 32;
    private static final int STOP_GRACE_SECONDS = 2;

    private final HttpServer server;
    private final ThreadPoolExecutor executor;
    private final BridgeCredentials credentials;
    private final BridgeEndpoints endpoints;

    private BridgeHttpServer(
            HttpServer server,
            ThreadPoolExecutor executor,
            BridgeCredentials credentials,
            BridgeEndpoints endpoints) {
        this.server = server;
        this.executor = executor;
        this.credentials = credentials;
        this.endpoints = endpoints;
    }

    public static BridgeHttpServer start(
            BridgeCredentials credentials,
            Supplier<Map<String, Object>> healthSupplier,
            Supplier<Map<String, Object>> capabilitiesSupplier) throws IOException {
        return start(credentials, BridgeEndpoints.readOnlyStub(healthSupplier, capabilitiesSupplier));
    }

    public static BridgeHttpServer start(BridgeCredentials credentials, BridgeEndpoints endpoints)
            throws IOException {

        // Loopback + port 0. Dış arayüze bind edilmesi imkânsız olmalıdır;
        // yapılandırılabilir bir bind adresi bilinçli olarak YOKTUR.
        InetSocketAddress address = new InetSocketAddress(InetAddress.getLoopbackAddress(), 0);
        HttpServer httpServer = HttpServer.create(address, 0);

        AtomicInteger counter = new AtomicInteger();
        ThreadFactory factory = runnable -> {
            Thread thread = new Thread(runnable, "mcp-bridge-http-" + counter.incrementAndGet());
            // Daemon: plugin disable sırasında bir thread sızarsa JVM'i rehin
            // almasın. Yine de close() içinde açıkça kapatılır.
            thread.setDaemon(true);
            return thread;
        };

        ThreadPoolExecutor pool = new ThreadPoolExecutor(
                WORKER_THREADS,
                WORKER_THREADS,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(QUEUE_CAPACITY),
                factory,
                new ThreadPoolExecutor.AbortPolicy());

        BridgeHttpServer bridge = new BridgeHttpServer(httpServer, pool, credentials, endpoints);

        httpServer.createContext("/v1/health", exchange -> bridge.route(exchange, Route.HEALTH));
        httpServer.createContext("/v1/capabilities", exchange -> bridge.route(exchange, Route.CAPABILITIES));
        httpServer.createContext("/v1/events", exchange -> bridge.route(exchange, Route.EVENTS));
        httpServer.createContext("/v1/query", exchange -> bridge.route(exchange, Route.QUERY));
        httpServer.createContext("/v1/action", exchange -> bridge.route(exchange, Route.ACTION));

        httpServer.setExecutor(pool);
        httpServer.start();
        return bridge;
    }

    private enum Route {
        HEALTH("GET"),
        CAPABILITIES("GET"),
        EVENTS("GET"),
        QUERY("POST"),
        ACTION("POST");

        private final String method;

        Route(String method) {
            this.method = method;
        }
    }

    public int port() {
        return server.getAddress().getPort();
    }

    private void route(HttpExchange exchange, Route route) {
        // DİKKAT: burada try-with-resources KULLANILMAZ. `try (exchange)`,
        // catch bloklarından ÖNCE exchange'i kapatır; hata yanıtı yazılamaz ve
        // istemci bağlantı kopması (EOF) görür. Kapatma finally'ye aittir.
        try {
            if (!route.method.equalsIgnoreCase(exchange.getRequestMethod())) {
                respondError(exchange, 405, "METHOD_NOT_ALLOWED", "Yalnızca " + route.method + " desteklenir.");
                return;
            }
            if (!validateHostAndOrigin(exchange) || !validateBodySize(exchange) || !authenticate(exchange)) {
                return;
            }

            switch (route) {
                case HEALTH -> respondJson(exchange, 200, Json.object(endpoints.health().get()));
                case CAPABILITIES -> respondJson(exchange, 200, Json.object(endpoints.capabilities().get()));
                case EVENTS -> handleEvents(exchange);
                case QUERY -> handleQuery(exchange);
                case ACTION -> handleAction(exchange);
            }
        } catch (EventCursorException e) {
            respondQuietly(exchange, e.kind().httpStatus(), e.kind().code(), e.getMessage());
        } catch (BridgeOperationException e) {
            respondQuietly(exchange, e.httpStatus(), e.code(), e.getMessage());
        } catch (BridgeTimeoutException e) {
            respondQuietly(exchange, BridgeTimeoutException.HTTP_STATUS, BridgeTimeoutException.CODE, e.getMessage());
        } catch (JsonReader.JsonParseException e) {
            respondQuietly(exchange, 400, "TOOL_INPUT_INVALID", e.getMessage());
        } catch (UnsupportedOperationException e) {
            respondQuietly(exchange, 501, "CAPABILITY_UNAVAILABLE", "Bu uç bu yapılandırmada etkin değil.");
        } catch (RejectedExecutionException e) {
            respondQuietly(exchange, 429, "BRIDGE_BUSY", "Bridge worker kuyruğu dolu.");
        } catch (RuntimeException | IOException e) {
            respondQuietly(exchange, 500, "BRIDGE_INTERNAL_ERROR", "İstek işlenemedi.");
        } finally {
            exchange.close();
        }
    }

    private void handleEvents(HttpExchange exchange) throws IOException {
        Map<String, String> params = parseQuery(exchange.getRequestURI().getRawQuery());

        String bootId = params.get("boot_id");
        if (bootId == null || bootId.isBlank()) {
            respondError(exchange, 400, "TOOL_INPUT_INVALID", "boot_id zorunludur.");
            return;
        }

        long after = parseLongParam(params.get("after"), 0L);
        int limit = (int) Math.min(parseLongParam(params.get("limit"), 100L), MAX_EVENT_RESULTS);
        if (after < 0 || limit < 1) {
            respondError(exchange, 400, "TOOL_INPUT_INVALID", "after >= 0 ve limit >= 1 olmalıdır.");
            return;
        }

        List<Map<String, Object>> events = endpoints.events().query(bootId, after, limit);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", Boolean.TRUE);
        body.put("bridge_boot_id", bootId);
        body.put("count", events.size());
        body.put("events", events);
        respondJson(exchange, 200, Json.object(body));
    }

    private void handleQuery(HttpExchange exchange) throws IOException {
        String raw = readBody(exchange);
        Map<String, Object> request = JsonReader.readObject(raw);

        Object operation = request.get("operation");
        if (!(operation instanceof String operationName) || operationName.isBlank()) {
            respondError(exchange, 400, "TOOL_INPUT_INVALID", "operation zorunludur.");
            return;
        }

        Object rawArgs = request.get("arguments");
        Map<String, Object> arguments;
        if (rawArgs == null) {
            arguments = Map.of();
        } else if (rawArgs instanceof Map<?, ?> map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> typed = (Map<String, Object>) map;
            arguments = typed;
        } else {
            respondError(exchange, 400, "TOOL_INPUT_INVALID", "arguments bir nesne olmalıdır.");
            return;
        }

        Map<String, Object> data = endpoints.query().execute(operationName, arguments);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", Boolean.TRUE);
        body.put("operation", operationName);
        body.put("data", data);
        respondJson(exchange, 200, Json.object(body));
    }

    private void handleAction(HttpExchange exchange) throws IOException {
        String raw = readBody(exchange);
        Map<String, Object> request = JsonReader.readObject(raw);

        Object operation = request.get("operation");
        if (!(operation instanceof String operationName) || operationName.isBlank()) {
            respondError(exchange, 400, "TOOL_INPUT_INVALID", "operation zorunludur.");
            return;
        }

        Object rawArgs = request.get("arguments");
        Map<String, Object> arguments;
        if (rawArgs == null) {
            arguments = Map.of();
        } else if (rawArgs instanceof Map<?, ?> map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> typed = (Map<String, Object>) map;
            arguments = typed;
        } else {
            respondError(exchange, 400, "TOOL_INPUT_INVALID", "arguments bir nesne olmalıdır.");
            return;
        }

        String idempotencyKey = null;
        Object rawKey = request.get("idempotency_key");
        if (rawKey instanceof String key && !key.isBlank()) {
            idempotencyKey = key;
        }

        Map<String, Object> data = endpoints.action().execute(operationName, arguments, idempotencyKey);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", Boolean.TRUE);
        body.put("operation", operationName);
        body.put("data", data);
        respondJson(exchange, 200, Json.object(body));
    }

    /** Gövdeyi sert bir üst sınırla okur; Content-Length yalanına güvenilmez. */
    private String readBody(HttpExchange exchange) throws IOException {
        try (InputStream in = exchange.getRequestBody()) {
            byte[] bytes = in.readNBytes(MAX_REQUEST_BODY_BYTES + 1);
            if (bytes.length > MAX_REQUEST_BODY_BYTES) {
                throw new BridgeOperationException(
                        "BODY_TOO_LARGE", 413, "İstek gövdesi izin verilen boyutu aşıyor.");
            }
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }

    static Map<String, String> parseQuery(String rawQuery) {
        Map<String, String> params = new LinkedHashMap<>();
        if (rawQuery == null || rawQuery.isEmpty()) {
            return params;
        }
        for (String pair : rawQuery.split("&")) {
            int eq = pair.indexOf('=');
            if (eq < 0) {
                continue;
            }
            String key = URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8);
            String value = URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
            params.putIfAbsent(key, value);
        }
        return params;
    }

    private static long parseLongParam(String raw, long fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        try {
            return Long.parseLong(raw.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /**
     * Host/Origin doğrulaması — DNS rebinding koruması.
     *
     * <p>Bir tarayıcı sayfası loopback portumuza istek atarsa {@code Origin}
     * başlığı gönderilir. Meşru istemcimiz tarayıcı değildir, bu yüzden
     * Origin'in <em>varlığı</em> tek başına reddetme gerekçesidir.
     */
    private boolean validateHostAndOrigin(HttpExchange exchange) throws IOException {
        String origin = exchange.getRequestHeaders().getFirst("Origin");
        if (origin != null) {
            respondError(exchange, 403, "BRIDGE_ORIGIN_REJECTED", "Origin başlığı taşıyan istekler reddedilir.");
            return false;
        }

        String host = exchange.getRequestHeaders().getFirst("Host");
        if (host == null || !isLoopbackHost(host)) {
            respondError(exchange, 403, "BRIDGE_ORIGIN_REJECTED", "Host başlığı loopback olmalıdır.");
            return false;
        }
        return true;
    }

    static boolean isLoopbackHost(String host) {
        String hostname = host;
        // IPv6 köşeli parantez biçimi: [::1]:12345
        if (hostname.startsWith("[")) {
            int end = hostname.indexOf(']');
            if (end < 0) {
                return false;
            }
            hostname = hostname.substring(1, end);
        } else {
            int colon = hostname.indexOf(':');
            if (colon >= 0) {
                hostname = hostname.substring(0, colon);
            }
        }
        return "127.0.0.1".equals(hostname) || "::1".equals(hostname) || "localhost".equalsIgnoreCase(hostname);
    }

    private boolean validateBodySize(HttpExchange exchange) throws IOException {
        String header = exchange.getRequestHeaders().getFirst("Content-Length");
        if (header == null) {
            return true;
        }
        long declared;
        try {
            declared = Long.parseLong(header.trim());
        } catch (NumberFormatException e) {
            respondError(exchange, 400, "BODY_TOO_LARGE", "Content-Length ayrıştırılamadı.");
            return false;
        }
        if (declared > MAX_REQUEST_BODY_BYTES) {
            respondError(exchange, 413, "BODY_TOO_LARGE", "İstek gövdesi izin verilen boyutu aşıyor.");
            return false;
        }
        return true;
    }

    private boolean authenticate(HttpExchange exchange) throws IOException {
        String presented = BridgeCredentials.extractBearer(exchange.getRequestHeaders().getFirst("Authorization"));
        if (!credentials.matches(presented)) {
            respondError(exchange, 401, "BRIDGE_UNAUTHORIZED", "Geçersiz veya eksik token.");
            return false;
        }
        return true;
    }

    private void respondJson(HttpExchange exchange, int status, String json) throws IOException {
        byte[] payload = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
        // Yanıt tarayıcıda saklanmamalı; loopback yüzeyi cache'lenebilir değildir.
        exchange.getResponseHeaders().add("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, payload.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(payload);
        }
    }

    private void respondError(HttpExchange exchange, int status, String code, String message) throws IOException {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("ok", Boolean.FALSE);
        error.put("error", Map.of("code", code, "message", message));
        respondJson(exchange, status, Json.object(error));
    }

    private void respondQuietly(HttpExchange exchange, int status, String code, String message) {
        try {
            respondError(exchange, status, code, message);
        } catch (IOException ignored) {
            // Bağlantı zaten kopmuş olabilir; kapanış yolu istisna fırlatmamalı.
        }
    }

    /**
     * M0 kabul kriteri: plugin disable sonrası Bridge thread'i veya açık portu
     * KALMAMALIDIR. Bu yüzden kapatma hem HTTP sunucusunu hem worker havuzunu
     * kapsar ve tamamlanmasını bekler.
     */
    @Override
    public void close() {
        server.stop(STOP_GRACE_SECONDS);
        executor.shutdown();
        try {
            if (!executor.awaitTermination(STOP_GRACE_SECONDS, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
