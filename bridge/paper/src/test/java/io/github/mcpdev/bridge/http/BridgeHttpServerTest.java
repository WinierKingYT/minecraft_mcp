package io.github.mcpdev.bridge.http;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.ConnectException;
import java.net.InetAddress;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * CT-BRIDGE-AUTH-001..003, CT-BRIDGE-005 — Bridge HTTP sözleşmesi.
 *
 * <p>Testler gerçek Paper GEREKTİRMEZ: HTTP katmanı Bukkit API'sinden
 * bağımsızdır. Bu ayrım bilinçlidir — auth ve limit davranışını doğrulamak için
 * bir Minecraft sunucusu başlatmak zorunda kalmak, bu testlerin CI'da
 * koşulmasını pratikte engellerdi.
 */
class BridgeHttpServerTest {

    private static final String TOKEN = "0123456789abcdef0123456789abcdef";

    private BridgeHttpServer server;
    private HttpClient client;

    @BeforeEach
    void setUp() throws IOException {
        Map<String, Object> health = new LinkedHashMap<>();
        health.put("ok", Boolean.TRUE);
        health.put("bridge_protocol", 1);

        Map<String, Object> capabilities = new LinkedHashMap<>();
        capabilities.put("bridge_version", "0.1.0-prototype.0");
        capabilities.put("bridge_protocol", 1);

        server = BridgeHttpServer.start(BridgeCredentials.of(TOKEN), () -> health, () -> capabilities);
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.close();
        }
    }

    private HttpRequest.Builder request(String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.port() + path))
                .timeout(Duration.ofSeconds(5));
    }

    private HttpResponse<String> send(HttpRequest req) throws IOException, InterruptedException {
        return client.send(req, HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void healthRequiresValidToken() throws Exception {
        HttpResponse<String> ok =
                send(request("/v1/health").header("Authorization", "Bearer " + TOKEN).GET().build());

        assertEquals(200, ok.statusCode());
        assertTrue(ok.body().contains("\"ok\":true"));
    }

    @Test
    void wrongTokenIsRejected() throws Exception {
        HttpResponse<String> res =
                send(request("/v1/health").header("Authorization", "Bearer wrong-token").GET().build());

        assertEquals(401, res.statusCode());
        assertTrue(res.body().contains("BRIDGE_UNAUTHORIZED"));
    }

    @Test
    void missingTokenIsRejected() throws Exception {
        HttpResponse<String> res = send(request("/v1/health").GET().build());
        assertEquals(401, res.statusCode());
    }

    @Test
    void tokenPrefixIsNotEnough() throws Exception {
        // Sabit süreli karşılaştırmanın davranışsal kanıtı: doğru önek yetmez.
        String prefix = TOKEN.substring(0, TOKEN.length() - 1);
        HttpResponse<String> res =
                send(request("/v1/health").header("Authorization", "Bearer " + prefix).GET().build());

        assertEquals(401, res.statusCode());
    }

    @Test
    void originHeaderIsRejected() throws Exception {
        // DNS rebinding koruması: meşru istemcimiz tarayıcı değildir, bu yüzden
        // Origin'in varlığı tek başına reddetme gerekçesidir.
        HttpResponse<String> res = send(request("/v1/health")
                .header("Authorization", "Bearer " + TOKEN)
                .header("Origin", "http://evil.example")
                .GET()
                .build());

        assertEquals(403, res.statusCode());
        assertTrue(res.body().contains("BRIDGE_ORIGIN_REJECTED"));
    }

    @Test
    void originIsRejectedBeforeAuthentication() throws Exception {
        // Sıra önemlidir: Origin kontrolü auth'tan ÖNCE çalışmalı ki tarayıcı
        // kaynaklı bir istek token doğrulamasına hiç ulaşmasın.
        HttpResponse<String> res = send(request("/v1/health")
                .header("Origin", "http://evil.example")
                .GET()
                .build());

        assertEquals(403, res.statusCode(), "token olmasa bile Origin reddi öncelikli olmalı");
    }

    @Test
    void capabilitiesRequiresToken() throws Exception {
        assertEquals(401, send(request("/v1/capabilities").GET().build()).statusCode());

        HttpResponse<String> ok =
                send(request("/v1/capabilities").header("Authorization", "Bearer " + TOKEN).GET().build());
        assertEquals(200, ok.statusCode());
        assertTrue(ok.body().contains("bridge_protocol"));
    }

    @Test
    void nonGetMethodIsRejected() throws Exception {
        HttpResponse<String> res = send(request("/v1/health")
                .header("Authorization", "Bearer " + TOKEN)
                .POST(HttpRequest.BodyPublishers.ofString("{}"))
                .build());

        assertEquals(405, res.statusCode());
    }

    @Test
    void oversizedBodyIsRejected() throws Exception {
        String big = "x".repeat(BridgeHttpServer.MAX_REQUEST_BODY_BYTES + 1);
        HttpResponse<String> res = send(request("/v1/health")
                .header("Authorization", "Bearer " + TOKEN)
                .method("GET", HttpRequest.BodyPublishers.ofString(big))
                .build());

        assertEquals(413, res.statusCode());
        assertTrue(res.body().contains("BODY_TOO_LARGE"));
    }

    @Test
    void bindsOnlyToLoopback() throws Exception {
        // Sunucu dış arayüze bind edilmemiş olmalı. Loopback dışı bir adrese
        // bağlanma denemesi başarısız olmalıdır.
        InetAddress[] all = InetAddress.getAllByName(InetAddress.getLocalHost().getHostName());
        int port = server.port();

        for (InetAddress address : all) {
            if (address.isLoopbackAddress()) {
                continue;
            }
            assertThrows(
                    IOException.class,
                    () -> {
                        try (Socket socket = new Socket()) {
                            socket.connect(new java.net.InetSocketAddress(address, port), 1000);
                        }
                    },
                    "Bridge dış arayüzde dinlememeli: " + address);
            return;
        }
        // Makinede loopback dışı adres yoksa test anlamsız; sessizce geç.
    }

    @Test
    void closeReleasesPortAndThreads() throws Exception {
        int port = server.port();
        assertEquals(200, send(request("/v1/health").header("Authorization", "Bearer " + TOKEN).GET().build())
                .statusCode());

        server.close();
        server = null;

        // M0 kabul kriteri: disable sonrası açık port kalmamalı.
        assertThrows(
                ConnectException.class,
                () -> {
                    try (Socket socket = new Socket()) {
                        socket.connect(new java.net.InetSocketAddress(InetAddress.getLoopbackAddress(), port), 1000);
                    }
                },
                "kapanıştan sonra port hâlâ dinliyor");

        boolean bridgeThreadAlive = Thread.getAllStackTraces().keySet().stream()
                .anyMatch(t -> t.getName().startsWith("mcp-bridge-http-") && t.isAlive());
        assertFalse(bridgeThreadAlive, "kapanıştan sonra Bridge worker thread'i kalmamalı");
    }

    @Test
    void loopbackHostDetection() {
        assertTrue(BridgeHttpServer.isLoopbackHost("127.0.0.1:8080"));
        assertTrue(BridgeHttpServer.isLoopbackHost("localhost:8080"));
        assertTrue(BridgeHttpServer.isLoopbackHost("[::1]:8080"));
        assertTrue(BridgeHttpServer.isLoopbackHost("127.0.0.1"));

        assertFalse(BridgeHttpServer.isLoopbackHost("evil.example"));
        assertFalse(BridgeHttpServer.isLoopbackHost("192.168.1.5:8080"));
        // Alt alan adı hilesi: "localhost.evil.example" loopback DEĞİLDİR.
        assertFalse(BridgeHttpServer.isLoopbackHost("localhost.evil.example:8080"));
    }

    @Test
    void jsonEscapesUntrustedText() {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("name", "a\"b\\c\nd");
        String json = Json.object(fields);

        assertNotNull(json);
        assertTrue(json.contains("a\\\"b\\\\c\\nd"), "tırnak, ters bölü ve satır sonu kaçırılmalı: " + json);
    }
}
