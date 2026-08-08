package io.github.mcpdev.bridge.http;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.mcpdev.bridge.events.EventCursorException;
import io.github.mcpdev.bridge.ops.BridgeOperationException;
import io.github.mcpdev.bridge.scheduler.BridgeTimeoutException;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * CT-BRIDGE-EVENTS-001, CT-BRIDGE-QUERY-001 — /v1/events ve /v1/query
 * uçlarının sözleşmesi.
 *
 * <p>Gerçek Paper GEREKTİRMEZ: handler'lar sahte implementasyonlarla
 * değiştirilir. Amaç, hata kodlarının HTTP durumlarına doğru eşlendiğini ve
 * girdi doğrulamasının çalıştığını kilitlemek.
 */
class BridgeEndpointsTest {

    private static final String TOKEN = "0123456789abcdef0123456789abcdef";
    private static final String BOOT = "boot_test";

    private BridgeHttpServer server;
    private HttpClient client;

    /** Test sırasında davranışı değiştirilebilen handler'lar. */
private BridgeEndpoints.EventsHandler eventsHandler;
private BridgeEndpoints.QueryHandler queryHandler;
private BridgeEndpoints.ActionHandler actionHandler;

    @BeforeEach
    void setUp() throws IOException {
        eventsHandler = (bootId, after, limit) -> {
            if (!BOOT.equals(bootId)) {
                throw new EventCursorException(
                        EventCursorException.Kind.INSTANCE_MISMATCH, "boot uyuşmuyor");
            }
            List<Map<String, Object>> out = new java.util.ArrayList<>();
            for (long seq = after + 1; seq <= after + Math.min(limit, 3); seq++) {
                out.add(Map.of("sequence", seq, "type", "plugin.enabled"));
            }
            return out;
        };
        queryHandler = (operation, arguments) -> {
            if ("server.get_state".equals(operation)) {
                return Map.of("paper_version", "26.2", "echo_args", arguments.size());
            }
            if ("world.set_block".equals(operation)) {
                throw new BridgeOperationException("TOOL_INPUT_INVALID", 400, "salt okuma değildir");
            }
            if ("slow.op".equals(operation)) {
                throw new BridgeTimeoutException("çok yavaş", true);
            }
            throw BridgeOperationException.capabilityUnavailable(operation);
        };
        actionHandler = (operation, arguments, idempotencyKey) ->
                Map.of("operation", operation, "idempotency_key", idempotencyKey == null ? "" : idempotencyKey);

        BridgeEndpoints endpoints = new BridgeEndpoints(
                () -> Map.of("ok", Boolean.TRUE),
                () -> Map.of("bridge_protocol", 1),
                (bootId, after, limit) -> eventsHandler.query(bootId, after, limit),
                (operation, arguments) -> queryHandler.execute(operation, arguments),
                (operation, arguments, idempotencyKey) ->
                        actionHandler.execute(operation, arguments, idempotencyKey));

        server = BridgeHttpServer.start(BridgeCredentials.of(TOKEN), endpoints);
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.close();
        }
    }

    private HttpRequest.Builder req(String pathAndQuery) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.port() + pathAndQuery))
                .header("Authorization", "Bearer " + TOKEN)
                .timeout(Duration.ofSeconds(5));
    }

    private HttpResponse<String> send(HttpRequest request) throws IOException, InterruptedException {
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> postQuery(String body) throws IOException, InterruptedException {
        return send(req("/v1/query").POST(HttpRequest.BodyPublishers.ofString(body)).build());
    }

    // ---------------------------------------------------------------- events

    @Test
    void eventsRequiresToken() throws Exception {
        HttpResponse<String> res = send(HttpRequest.newBuilder(
                        URI.create("http://127.0.0.1:" + server.port() + "/v1/events?boot_id=" + BOOT))
                .GET()
                .build());
        assertEquals(401, res.statusCode());
    }

    @Test
    void eventsReturnsEventsAfterCursor() throws Exception {
        HttpResponse<String> res = send(req("/v1/events?boot_id=" + BOOT + "&after=10&limit=2").GET().build());

        assertEquals(200, res.statusCode());
        assertTrue(res.body().contains("\"count\":2"), res.body());
        assertTrue(res.body().contains("\"sequence\":11"), res.body());
    }

    @Test
    void eventsRequiresBootId() throws Exception {
        HttpResponse<String> res = send(req("/v1/events").GET().build());

        assertEquals(400, res.statusCode());
        assertTrue(res.body().contains("TOOL_INPUT_INVALID"));
    }

    @Test
    void cursorFromAnotherBootMapsTo409() throws Exception {
        HttpResponse<String> res = send(req("/v1/events?boot_id=boot_other").GET().build());

        assertEquals(409, res.statusCode());
        assertTrue(res.body().contains("EVENT_CURSOR_INSTANCE_MISMATCH"), res.body());
    }

    @Test
    void expiredCursorMapsTo409() throws Exception {
        eventsHandler = (bootId, after, limit) -> {
            throw new EventCursorException(EventCursorException.Kind.EXPIRED, "düştü");
        };

        HttpResponse<String> res = send(req("/v1/events?boot_id=" + BOOT).GET().build());

        assertEquals(409, res.statusCode());
        assertTrue(res.body().contains("EVENT_CURSOR_EXPIRED"));
    }

    @Test
    void negativeCursorIsRejected() throws Exception {
        HttpResponse<String> res = send(req("/v1/events?boot_id=" + BOOT + "&after=-1").GET().build());
        assertEquals(400, res.statusCode());
    }

    @Test
    void limitIsCappedAtConfiguredMaximum() throws Exception {
        // İstemci 999999 istese bile üst sınır uygulanır.
        final long[] seenLimit = {0};
        eventsHandler = (bootId, after, limit) -> {
            seenLimit[0] = limit;
            return List.of();
        };

        send(req("/v1/events?boot_id=" + BOOT + "&limit=999999").GET().build());

        assertEquals(BridgeHttpServer.MAX_EVENT_RESULTS, seenLimit[0]);
    }

    // ----------------------------------------------------------------- query

    @Test
    void queryRequiresToken() throws Exception {
        HttpResponse<String> res = send(HttpRequest.newBuilder(
                        URI.create("http://127.0.0.1:" + server.port() + "/v1/query"))
                .POST(HttpRequest.BodyPublishers.ofString("{\"operation\":\"server.get_state\"}"))
                .build());
        assertEquals(401, res.statusCode());
    }

    @Test
    void queryDispatchesReadOperation() throws Exception {
        HttpResponse<String> res = postQuery("{\"operation\":\"server.get_state\",\"arguments\":{}}");

        assertEquals(200, res.statusCode());
        assertTrue(res.body().contains("\"paper_version\":\"26.2\""), res.body());
        assertTrue(res.body().contains("\"operation\":\"server.get_state\""));
    }

    @Test
    void queryWithoutArgumentsDefaultsToEmpty() throws Exception {
        HttpResponse<String> res = postQuery("{\"operation\":\"server.get_state\"}");

        assertEquals(200, res.statusCode());
        assertTrue(res.body().contains("\"echo_args\":0"));
    }

    @Test
    void queryRequiresOperation() throws Exception {
        HttpResponse<String> res = postQuery("{\"arguments\":{}}");

        assertEquals(400, res.statusCode());
        assertTrue(res.body().contains("TOOL_INPUT_INVALID"));
    }

    @Test
    void mutationOperationIsRejected() throws Exception {
        HttpResponse<String> res = postQuery("{\"operation\":\"world.set_block\"}");

        assertEquals(400, res.statusCode());
        assertTrue(res.body().contains("TOOL_INPUT_INVALID"));
    }

    @Test
    void unknownOperationMapsTo501() throws Exception {
        HttpResponse<String> res = postQuery("{\"operation\":\"world.explode\"}");

        assertEquals(501, res.statusCode());
        assertTrue(res.body().contains("CAPABILITY_UNAVAILABLE"));
    }

    @Test
    void timeoutMapsTo504() throws Exception {
        HttpResponse<String> res = postQuery("{\"operation\":\"slow.op\"}");

        assertEquals(504, res.statusCode());
        assertTrue(res.body().contains("BRIDGE_TIMEOUT"));
    }

    @Test
    void malformedJsonIsRejected() throws Exception {
        HttpResponse<String> res = postQuery("{ bu gecerli json degil");

        assertEquals(400, res.statusCode());
        assertTrue(res.body().contains("TOOL_INPUT_INVALID"));
    }

    @Test
    void trailingContentAfterJsonIsRejected() throws Exception {
        // "Smuggling": ayrıştırıcılar arasındaki fark istismar edilemesin.
        HttpResponse<String> res = postQuery("{\"operation\":\"server.get_state\"} {\"operation\":\"evil\"}");

        assertEquals(400, res.statusCode());
    }

    @Test
    void duplicateJsonKeyIsRejected() throws Exception {
        HttpResponse<String> res =
                postQuery("{\"operation\":\"server.get_state\",\"operation\":\"world.set_block\"}");

        assertEquals(400, res.statusCode());
    }

    @Test
    void getOnQueryEndpointIsRejected() throws Exception {
        HttpResponse<String> res = send(req("/v1/query").GET().build());
        assertEquals(405, res.statusCode());
    }

    @Test
    void queryStringParsingIgnoresDuplicateKeys() {
        Map<String, String> params = BridgeHttpServer.parseQuery("boot_id=a&boot_id=b&after=5");

        assertEquals("a", params.get("boot_id"), "ilk değer kazanır; parametre kirletme engellenir");
        assertEquals("5", params.get("after"));
    }

    @Test
    void jsonReaderRejectsDeeplyNestedPayload() {
        String nested = "{\"a\":".repeat(JsonReader.MAX_DEPTH + 2) + "1" + "}".repeat(JsonReader.MAX_DEPTH + 2);

        LinkedHashMap<String, Object> unused = new LinkedHashMap<>();
        assertTrue(unused.isEmpty());

        org.junit.jupiter.api.Assertions.assertThrows(
                JsonReader.JsonParseException.class, () -> JsonReader.readObject(nested));
    }
}
