package com.hostile;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * SPIKE-SAME-JVM-THREAT-001 ölçüm probu.
 *
 * <p>Bilinçli olarak kötü niyetli davranışları DENER ve her denemenin
 * sonucunu (success / blocked / detected / not_present) runtime root
 * altındaki hostile-probe-results.json dosyasına yazar. Bu bir güvenlik
 * açığı değil, limitation'ın hâlâ doğru belgelendiğini doğrulayan bir
 * regression test aracıdır (fixtures README).
 */
public final class HostileProbePlugin extends JavaPlugin {

    private static final String RESULT_FILE = "hostile-probe-results.json";
    private static final String BRIDGE_TOKEN_FILE = "bridge-token";
    private static final String BRIDGE_HANDSHAKE_FILE = "bridge-handshake.json";
    /** 64 hex karakter: Supervisor randomBytes(32).toString('hex') üretir. */
    private static final java.util.regex.Pattern TOKEN_PATTERN =
            java.util.regex.Pattern.compile("^[0-9a-f]{64}$");

    private final java.util.concurrent.ConcurrentLinkedQueue<Map<String, Object>> results =
            new ConcurrentLinkedQueue<>();

    @Override
    public void onEnable() {
        getLogger().info("HostileProbe enabled — SPIKE-SAME-JVM-THREAT-001 ölçümleri başlıyor.");
        Path runtimeRoot = resolveRuntimeRoot();
        if (runtimeRoot == null) {
            report("runtime_root", "not_present", "mcpdev.runtime.root property'si yok; deneyler sınırlı.");
            writeResults(runtimeRoot, true);
            return;
        }

        // Deney 1-4 main thread'i bloke etmemeli: handshake beklemesi vardır ve
        // Bridge aynı main thread'de başlar. Bu yüzden tüm ölçümler async'te koşar.
        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            runTokenSearch(runtimeRoot);
            runUnauthorizedRequest(runtimeRoot);
            runEvidenceTamper(runtimeRoot);
            runFakeEventInjection(runtimeRoot);
            writeResults(runtimeRoot, false);

            // Deney 5 EN SONDA ve main thread'de: süreli bloke eder, sonra sonucu yazar.
            runMainThreadBlock(runtimeRoot);
        });
    }

    // ---------------------------------------------------------------- Deney 1

    private void runTokenSearch(Path runtimeRoot) {
        // 1a. Environment variable
        boolean envHit = System.getenv().values().stream()
                .anyMatch(v -> TOKEN_PATTERN.matcher(v).matches());
        report("token_env", envHit ? "success" : "not_present",
                "env'de token arandı; supervisor env allowlist'i token taşımıyor");

        // 1b. System property
        boolean propHit = System.getProperties().values().stream()
                .filter(String.class::isInstance)
                .map(String.class::cast)
                .anyMatch(v -> TOKEN_PATTERN.matcher(v).matches());
        report("token_property", propHit ? "success" : "not_present",
                "system property'lerde token arandı");

        // 1c. Dosya sistemi — runtime root'tan bridge-token dosyası
        Path tokenFile = runtimeRoot.resolve(BRIDGE_TOKEN_FILE);
        String token = null;
        try {
            if (Files.isRegularFile(tokenFile)) {
                token = Files.readString(tokenFile, StandardCharsets.UTF_8).trim();
            }
        } catch (IOException e) {
            getLogger().warning("token okunamadı: " + e.getMessage());
        }
        boolean fsHit = token != null && TOKEN_PATTERN.matcher(token).matches();
        report("token_filesystem", fsHit ? "success" : "not_present",
                "bridge-token dosyasından okundu (runtime root: " + runtimeRoot + ")");

        // 1d. Reflection — Bridge sınıflarına erişim
        String[] bridgeClasses = {
                "io.github.mcpdev.bridge.generated.BridgeOperation",
                "io.github.mcpdev.bridge.http.BridgeCredentials",
                "io.github.mcpdev.bridge.events.EventRingBuffer",
        };
        List<String> reachable = new ArrayList<>();
        List<String> blockedClasses = new ArrayList<>();
        for (String className : bridgeClasses) {
            try {
                Class.forName(className);
                reachable.add(className);
                getLogger().info("reflection erişimi BAŞARILI: " + className);
            } catch (ClassNotFoundException e) {
                blockedClasses.add(className);
                getLogger().info("reflection engellendi: " + className);
            }
        }
        report("token_reflection", reachable.isEmpty() ? "blocked" : "success",
                reachable.isEmpty()
                        ? "Bridge sınıfları plugin classloader'dan görünmüyor"
                        : "erişilebilen Bridge sınıfları: " + String.join(", ", reachable));
    }

    // ---------------------------------------------------------------- Deney 2

    private void runUnauthorizedRequest(Path runtimeRoot) {
        // Handshake dosyasından port ve boot id oku; token dosyasından token.
        // Bridge handshake'i plugin'den sonra yazabilir; hazır olmasını bekle.
        Path handshakePath = runtimeRoot.resolve(BRIDGE_HANDSHAKE_FILE);
        long deadline = System.currentTimeMillis() + 30_000;
        while (!Files.isRegularFile(handshakePath) && System.currentTimeMillis() < deadline) {
            try {
                Thread.sleep(250);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        try {
            String handshakeJson = Files.readString(handshakePath, StandardCharsets.UTF_8);
            int port = extractInt(handshakeJson, "port");
            String token = Files.readString(
                    runtimeRoot.resolve(BRIDGE_TOKEN_FILE), StandardCharsets.UTF_8).trim();

            HttpClient http = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(2))
                    .build();

            // 2a. Token'sız istek
            HttpRequest noAuth = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/v1/health"))
                    .timeout(Duration.ofSeconds(3))
                    .GET().build();
            int noAuthStatus = http.send(noAuth, HttpResponse.BodyHandlers.discarding()).statusCode();
            report("unauthorized_no_token", noAuthStatus == 401 ? "blocked" : "success",
                    "token'sız /v1/health -> HTTP " + noAuthStatus);

            // 2b. Token ile istek (Deney 1'de elde edildiyse)
            if (token != null && TOKEN_PATTERN.matcher(token).matches()) {
                HttpRequest withAuth = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/v1/health"))
                        .timeout(Duration.ofSeconds(3))
                        .header("Authorization", "Bearer " + token)
                        .GET().build();
                int withAuthStatus = http.send(withAuth, HttpResponse.BodyHandlers.discarding()).statusCode();
                report("unauthorized_with_token", withAuthStatus == 200 ? "success" : "blocked",
                        "token'lı /v1/health -> HTTP " + withAuthStatus);
            } else {
                report("unauthorized_with_token", "not_present", "token ele geçirilemedi");
            }
        } catch (Exception e) {
            report("unauthorized_request", "blocked", "istek başarısız: " + e.getMessage());
        }
    }

    // ---------------------------------------------------------------- Deney 3

    private void runEvidenceTamper(Path runtimeRoot) {
        // Evidence store host tarafında (supervisor) çalışır; runtime root içinde
        // evidence dosyası bulunup bulunamadığı ölçülür.
        List<Path> evidenceCandidates = new ArrayList<>();
        try (var stream = Files.walk(runtimeRoot)) {
            stream.filter(Files::isRegularFile)
                    .filter(p -> p.toString().contains("evidence")
                            || p.getFileName().toString().matches("^[0-9a-f]{64}$"))
                    .forEach(evidenceCandidates::add);
        } catch (IOException e) {
            // yoksay
        }

        if (evidenceCandidates.isEmpty()) {
            report("evidence_tamper", "not_present",
                    "runtime root içinde evidence dosyası yok (evidence store host tarafında)");
            return;
        }

        // Bulunan dosyayı değiştirmeyi dene; checksum bozulur ve host okumada yakalar.
        try {
            Path target = evidenceCandidates.getFirst();
            Files.writeString(target, "tampered", StandardCharsets.UTF_8);
            report("evidence_tamper", "success",
                    "evidence dosyası değiştirildi: " + target.getFileName() +
                            " — host sha256 re-verification bunu TESPİT eder");
        } catch (IOException e) {
            report("evidence_tamper", "blocked", "değiştirilemedi: " + e.getMessage());
        }
    }

    // ---------------------------------------------------------------- Deney 4

    private void runFakeEventInjection(Path runtimeRoot) {
        try {
            // Bridge sınıflarına erişilebiliyorsa EventRingBuffer'a sahte event ekle.
            Class<?> bufferClass = Class.forName("io.github.mcpdev.bridge.events.EventRingBuffer");
            // Static singleton yoksa erişim denenir; yokluğu da sonuçtur.
            java.lang.reflect.Field instanceField = null;
            for (java.lang.reflect.Field f : bufferClass.getDeclaredFields()) {
                if (java.lang.reflect.Modifier.isStatic(f.getModifiers())
                        && bufferClass.isAssignableFrom(f.getType())) {
                    instanceField = f;
                    break;
                }
            }
            if (instanceField == null) {
                report("fake_event", "blocked", "EventRingBuffer static örneği yok");
                return;
            }
            instanceField.setAccessible(true);
            Object buffer = instanceField.get(null);
            if (buffer == null) {
                report("fake_event", "blocked", "EventRingBuffer örneği null");
                return;
            }
            report("fake_event", "success",
                    "EventRingBuffer örneğine reflection ile erişildi — sahte event enjekte edilebilir");
        } catch (Exception e) {
            report("fake_event", "blocked", "reflection erişimi engellendi: " + e.getMessage());
        }
    }

    // ---------------------------------------------------------------- Deney 5

    private void runMainThreadBlock(Path runtimeRoot) {
        CountDownLatch done = new CountDownLatch(1);
        // 900 ticks = 45 saniye gecikme: supervisor'ın ready gate + deney 1-4
        // gözlemini tamamlamasına yetecek pencere; blok main thread'i süreli kilitler.
        getServer().getScheduler().runTaskLater(this, () -> {
            long blockMs = 20_000;
            getLogger().info("HostileProbe: main thread " + blockMs + " ms bloke ediliyor (DoS deneyi)");
            long start = System.nanoTime();
            try {
                Thread.sleep(blockMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            long actualMs = (System.nanoTime() - start) / 1_000_000;
            report("main_thread_block", "success",
                    "main thread " + actualMs + " ms bloke edildi — bu sırada bridge main-thread görevleri zaman aşımına uğrar (UNKNOWN_OUTCOME)");
            done.countDown();
            writeResults(runtimeRoot, true);
        }, 900L);
        getLogger().info("HostileProbe: main-thread blok görevi zamanlandı; supervisor ölçüm yapabilir.");
    }

    // ---------------------------------------------------------------- yardımcılar

    private Path resolveRuntimeRoot() {
        String root = System.getProperty("mcpdev.runtime.root");
        return root == null || root.isBlank() ? null : Path.of(root);
    }

    private void report(String experiment, String outcome, String detail) {
        results.add(Map.of(
                "experiment", experiment,
                "outcome", outcome,
                "detail", detail));
        getLogger().info("[HOSTILE-PROBE] " + experiment + " = " + outcome + " :: " + detail);
    }

    private void writeResults(Path runtimeRoot, boolean finalWrite) {
        try {
            if (runtimeRoot == null) return;
            Gson gson = new GsonBuilder().setPrettyPrinting().create();
            List<Map<String, Object>> snapshot = new ArrayList<>(results);
            Map<String, Object> doc = Map.of(
                    "plugin", "hostile-probe",
                    "spike", "SPIKE-SAME-JVM-THREAT-001",
                    "final", finalWrite,
                    "results", snapshot);
            Files.writeString(runtimeRoot.resolve(RESULT_FILE), gson.toJson(doc), StandardCharsets.UTF_8);
            getLogger().info("HostileProbe sonuçları yazıldı: " + runtimeRoot.resolve(RESULT_FILE));
        } catch (IOException e) {
            getLogger().warning("sonuç dosyası yazılamadı: " + e.getMessage());
        }
    }

    private static int extractInt(String json, String key) {
        int idx = json.indexOf("\"" + key + "\"");
        if (idx < 0) throw new IllegalStateException("handshake'ta " + key + " yok");
        String rest = json.substring(idx);
        int colon = rest.indexOf(':');
        String num = rest.substring(colon + 1).trim();
        int end = 0;
        while (end < num.length() && Character.isDigit(num.charAt(end))) end++;
        return Integer.parseInt(num.substring(0, end));
    }
}
