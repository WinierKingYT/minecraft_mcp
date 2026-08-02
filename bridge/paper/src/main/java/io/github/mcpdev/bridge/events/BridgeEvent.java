package io.github.mcpdev.bridge.events;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Tek bir gözlem olayı.
 *
 * <p>Şema: packages/contracts/schemas/bridge/bridge-event.schema.json
 *
 * <p><strong>Kişisel veri taşımaz</strong> (EV-05): {@code actorId} bir test
 * actor kimliğidir, gerçek hesap kimliği veya IP değildir. Chat olayları
 * varsayılan olarak hiç üretilmez (EV-04).
 */
public record BridgeEvent(
        long sequence,
        String eventId,
        String type,
        String bootId,
        String serverInstanceId,
        String correlationId,
        String causationId,
        long serverTick,
        String occurredAt,
        String actorKind,
        String actorId,
        Map<String, Object> data,
        String source) {

    public BridgeEvent {
        Objects.requireNonNull(eventId, "eventId");
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(bootId, "bootId");
        data = data == null ? Map.of() : Map.copyOf(data);
    }

    /** JSON gövdesi için düzleştirilmiş gösterim. */
    public Map<String, Object> toMap() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("sequence", sequence);
        map.put("event_id", eventId);
        map.put("type", type);
        map.put("bridge_boot_id", bootId);
        map.put("server_instance_id", serverInstanceId);
        map.put("correlation_id", correlationId);
        map.put("causation_id", causationId);
        map.put("server_tick", serverTick);
        map.put("occurred_at", occurredAt);
        if (actorKind != null) {
            map.put("actor", Map.of("kind", actorKind, "id", actorId == null ? "" : actorId));
        } else {
            map.put("actor", null);
        }
        map.put("data", data);
        map.put("source", source);
        return map;
    }
}
