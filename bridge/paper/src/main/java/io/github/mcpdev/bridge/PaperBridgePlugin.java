package io.github.mcpdev.bridge;

import io.github.mcpdev.bridge.events.BridgeEvent;
import io.github.mcpdev.bridge.events.EventRingBuffer;
import io.github.mcpdev.bridge.http.BridgeCredentials;
import io.github.mcpdev.bridge.http.BridgeEndpoints;
import io.github.mcpdev.bridge.http.BridgeHttpServer;
import io.github.mcpdev.bridge.ops.ActionDispatcher;
import io.github.mcpdev.bridge.ops.NmsActorHandler;
import io.github.mcpdev.bridge.ops.PaperReadOperations;
import io.github.mcpdev.bridge.ops.PaperWorldMutations;
import io.github.mcpdev.bridge.ops.QueryDispatcher;
import io.github.mcpdev.bridge.scheduler.PaperMainThreadExecutor;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.logging.Level;
import org.bukkit.Bukkit;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.server.ServerLoadEvent;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Paper Bridge — Paper JVM'i içinde çalışan gözlem eklentisi.
 *
 * <p>ADR-0001: Bridge ayrı bir işletim sistemi process'i değildir. Paper API'ye
 * erişim yalnızca Paper JVM'i içinden mümkündür.
 *
 * <p><strong>Güvenlik sınırı uyarısı (ADR-0007):</strong> Bridge, hedef plugin
 * ile aynı JVM'de çalışır. Loopback bind + token doğrulaması rastgele localhost
 * process'lerine ve tarayıcı kaynaklı isteklere karşı koruma sağlar; ancak aynı
 * JVM içindeki aktif kötü niyetli bir hedef plugin'e karşı
 * <em>güvenlik sınırı değildir</em>. T2 sınıfı projeler Container backend
 * içinde çalıştırılmalıdır.
 */
public final class PaperBridgePlugin extends JavaPlugin implements Listener {

    /** Paper API çağrıları için üst sınır; capability limitleriyle uyumlu. */
    private static final Duration OPERATION_TIMEOUT = Duration.ofMillis(2000);

    private BridgeBoot boot;
    private BridgeHttpServer httpServer;
    private BridgeRuntimeContext context;
    private EventRingBuffer events;

    @Override
    public void onEnable() {
        this.boot = BridgeBoot.create();
        this.events = new EventRingBuffer(boot.bootId(), EventRingBuffer.DEFAULT_CAPACITY);
        getLogger().info(() -> "PaperBridge enabled; bridge_boot_id=" + boot.bootId());

        Optional<BridgeRuntimeContext> detected = BridgeRuntimeContext.detect();
        if (detected.isEmpty()) {
            // Yönetilen runtime dışında kontrol yüzeyi AÇILMAZ.
            getLogger().warning("Yönetilen runtime tespit edilmedi; Bridge HTTP sunucusu başlatılmadı.");
            getLogger().warning("Bu eklenti yalnızca Minecraft Plugin Development MCP runtime'ları içinde çalışır.");
            return;
        }

        this.context = detected.get();
        try {
            BridgeCredentials credentials = BridgeCredentials.fromFile(context.tokenFile());

            QueryDispatcher dispatcher = new QueryDispatcher(
                    new PaperReadOperations(getServer()),
                    new PaperMainThreadExecutor(this, getServer()));

            // M2B Actor Handler (NMS ile gerçek oyuncu oluşturma)
            NmsActorHandler actorHandler = new NmsActorHandler(getServer(), events, getLogger());
            // M2A dünya mutation'ları: fixture manifest bölgesi + materyal sınırları
            PaperWorldMutations worldMutations = new PaperWorldMutations(
                    getServer(), context.runtimeRoot(), new PaperMainThreadExecutor(this, getServer()));
            ActionDispatcher actionDispatcher = new ActionDispatcher(actorHandler, worldMutations,
                    new PaperMainThreadExecutor(this, getServer()));

            BridgeEndpoints endpoints = new BridgeEndpoints(
                    this::health,
                    this::capabilities,
                    (bootId, after, limit) ->
                            events.query(bootId, after, limit).stream().map(BridgeEvent::toMap).toList(),
                    (operation, arguments) -> dispatcher.dispatch(operation, arguments, OPERATION_TIMEOUT),
                    (operation, arguments, idempotencyKey) ->
                            actionDispatcher.dispatch(operation, arguments, idempotencyKey));

            this.httpServer = BridgeHttpServer.start(credentials, endpoints);
            HandshakeFile.write(context.runtimeRoot(), boot, httpServer.port(), context.serverInstanceId());

            getServer().getPluginManager().registerEvents(this, this);
            recordEvent("plugin.enabled", Map.of("plugin", getName()));

            getLogger().info(() -> "Bridge loopback dinliyor: 127.0.0.1:" + httpServer.port());
        } catch (IOException e) {
            // Token okunamadıysa veya port alınamadıysa sunucu AÇIK KALMAZ.
            getLogger().log(Level.SEVERE, "Bridge HTTP sunucusu başlatılamadı", e);
            shutdownHttp();
        }
    }

    @Override
    public void onDisable() {
        // M0 kabul kriteri: plugin disable sonrası Bridge thread'i veya açık
        // portu kalmamalıdır.
        shutdownHttp();

        if (boot != null) {
            getLogger().log(Level.INFO, "PaperBridge disabled; bridge_boot_id={0}", boot.bootId());
            boot = null;
        }
        events = null;
    }

    /** Ready gate'in üçüncü şartı: sunucu yükleme tamamlandı. */
    @EventHandler
    public void onServerLoad(ServerLoadEvent event) {
        recordEvent("server.ready", Map.of("type", event.getType().name()));
    }

    /**
     * Message capture (M2B): her oyuncu chat'i ring buffer'a yazılır.
     *
     * <p>EV-04 uyumu: chat yalnızca test runtime'larında dinlenir ve test
     * actor kimlikleri kaydedilir; gerçek hesap kimliği taşınmaz. İptal
     * semantiği korunur: event iptal edilmişse {@code cancelled=true} ile
     * kaydedilir.
     */
    @EventHandler
    @SuppressWarnings("deprecation") // AsyncPlayerChatEvent test-only kullanımı
    public void onPlayerChat(AsyncPlayerChatEvent event) {
        EventRingBuffer buffer = events;
        if (buffer == null) {
            return;
        }
        String actorId = event.getPlayer().getName();
        long tick = getServer().getCurrentTick();
        final boolean cancelled = event.isCancelled();
        final String message = event.getMessage();
        buffer.append((sequence, bootId) -> new BridgeEvent(
                sequence,
                "evt_" + bootId + "_" + sequence,
                "player.message",
                bootId,
                context == null ? null : context.serverInstanceId(),
                null,
                null,
                tick,
                Instant.now().toString(),
                "test_actor",
                actorId,
                Map.of(
                        "message", message,
                        "cancelled", cancelled,
                        "sender", actorId),
                "paper"));
    }

    private void shutdownHttp() {
        if (httpServer != null) {
            httpServer.close();
            httpServer = null;
        }
        if (context != null) {
            try {
                HandshakeFile.delete(context.runtimeRoot());
            } catch (IOException e) {
                // Kalan handshake dosyası, Supervisor'ın ölü bir porta
                // bağlanmayı denemesine yol açar; sessiz geçilmez.
                getLogger().log(Level.WARNING, "Handshake dosyası silinemedi", e);
            }
            context = null;
        }
    }

    private void recordEvent(String type, Map<String, Object> data) {
        EventRingBuffer buffer = events;
        BridgeRuntimeContext ctx = context;
        if (buffer == null) {
            return;
        }
        long tick = getServer().getCurrentTick();
        buffer.append((sequence, bootId) -> new BridgeEvent(
                sequence,
                "evt_" + bootId + "_" + sequence,
                type,
                bootId,
                ctx == null ? null : ctx.serverInstanceId(),
                null,
                null,
                tick,
                Instant.now().toString(),
                null,
                null,
                data,
                "paper"));
    }

    /** GET /v1/health */
    private Map<String, Object> health() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", Boolean.TRUE);
        body.put("bridge_protocol", BridgeBoot.PROTOCOL_VERSION);
        body.put("bridge_boot_id", boot == null ? null : boot.bootId());
        body.put("server_instance_id", context == null ? null : context.serverInstanceId());
        body.put("event_sequence", events == null ? 0L : events.latestSequence());
        body.put("event_dropped", events == null ? 0L : events.droppedCount());
        return body;
    }

    /**
     * GET /v1/capabilities
     *
     * <p>Operation listesi capability registry'den üretilen
     * {@code BridgeOperation} enum'undan türetilir; elle tutulan bir liste
     * yoktur.
     */
    private Map<String, Object> capabilities() {
        Map<String, Object> operations = new LinkedHashMap<>();
        for (io.github.mcpdev.bridge.generated.BridgeOperation op :
                io.github.mcpdev.bridge.generated.BridgeOperation.values()) {
            if (QueryDispatcher.isReadOnly(op)) {
                operations.put(op.wireName(), Map.of("risk", "R0", "max_timeout_ms", OPERATION_TIMEOUT.toMillis()));
            } else if (ActionDispatcher.SUPPORTED_OPERATIONS.contains(op)) {
                operations.put(op.wireName(), Map.of("risk", "R2", "max_timeout_ms", 30000));
            }
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("bridge_version", getPluginMeta().getVersion());
        body.put("bridge_protocol", BridgeBoot.PROTOCOL_VERSION);
        body.put("paper_version", Bukkit.getMinecraftVersion());
        body.put("java_version", Runtime.version().feature());
        body.put("server_instance_id", context == null ? null : context.serverInstanceId());
        body.put("bridge_boot_id", boot == null ? null : boot.bootId());
        body.put("folia", Boolean.FALSE);
        body.put("operations", operations);
        body.put("events", List.of("server.ready", "plugin.enabled", "plugin.disabled",
                "test_actor.created", "test_actor.disconnected_all",
                "player.move", "player.look", "player.chat", "player.command", "player.message",
                "block.break"));
        body.put("event_buffer_capacity", events == null ? 0 : events.capacity());
        body.put("known_limitations", List.of(
                "Bridge auth, aynı Paper JVM'i içindeki aktif kötü niyetli hedef plugin'e karşı güvenlik sınırı değildir."));
        return body;
    }

    /** Test ve teşhis için mevcut boot; devre dışıyken {@code null}. */
    public BridgeBoot boot() {
        return boot;
    }
}
