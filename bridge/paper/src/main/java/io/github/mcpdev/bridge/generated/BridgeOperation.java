// Bu dosya `pnpm run gen` tarafından üretilir. ELLE DÜZENLEMEYİN.
package io.github.mcpdev.bridge.generated;

public enum BridgeOperation {
    EVENTS_QUERY("events.query"),
    LOGS_QUERY("logs.query"),
    PERMISSION_ATTACH("permission.attach"),
    PERMISSION_CHECK("permission.check"),
    PERMISSION_DETACH("permission.detach"),
    PERMISSION_SET_OP("permission.set_op"),
    PLAYER_BREAK_BLOCK("player.break_block"),
    PLAYER_CHAT("player.chat"),
    PLAYER_GET_STATE("player.get_state"),
    PLAYER_LOOK("player.look"),
    PLAYER_MOVE("player.move"),
    PLUGIN_COMMAND("plugin.command"),
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
    TEST_ACTOR_CREATE("test_actor.create"),
    TEST_ACTOR_DISCONNECT_ALL("test_actor.disconnect_all"),
    WORLD_GET_BLOCK("world.get_block"),
    WORLD_LIST("world.list"),
    WORLD_SET_BLOCK("world.set_block"),
    WORLD_SET_CHUNK_TICKET("world.set_chunk_ticket");

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
