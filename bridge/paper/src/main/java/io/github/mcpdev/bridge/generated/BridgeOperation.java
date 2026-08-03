// Bu dosya `pnpm run gen` tarafından üretilir. ELLE DÜZENLEMEYİN.
package io.github.mcpdev.bridge.generated;

public enum BridgeOperation {
    EVENTS_QUERY("events.query"),
    LOGS_QUERY("logs.query"),
    PERMISSION_ATTACH("permission.attach"),
    PERMISSION_CHECK("permission.check"),
    PERMISSION_DETACH("permission.detach"),
    PERMISSION_SET_OP("permission.set_op"),
    PLAYER_GET_STATE("player.get_state"),
    PLUGIN_GET("plugin.get"),
    PLUGIN_LIST("plugin.list"),
    POOL_ACQUIRE("pool.acquire"),
    POOL_EVICT("pool.evict"),
    POOL_LIST("pool.list"),
    POOL_RELEASE("pool.release"),
    POOL_RESET("pool.reset"),
    POOL_STATUS("pool.status"),
    PROFILE_GET("profile.get"),
    PROFILE_LIST("profile.list"),
    SERVER_GET_STATE("server.get_state"),
    WORLD_GET_BLOCK("world.get_block"),
    WORLD_LIST("world.list"),
    WORLD_SET_BLOCK("world.set_block");

    private final String wireName;

    BridgeOperation(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }

    public static BridgeOperation fromWireName(String value) {
        for (BridgeOperation op : values()) {
            if (op.wireName.equals(value)) {
                return op;
            }
        }
        throw new IllegalArgumentException("Unknown bridge operation: " + value);
    }
}
