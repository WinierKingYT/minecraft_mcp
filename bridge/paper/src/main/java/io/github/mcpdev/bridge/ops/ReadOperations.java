package io.github.mcpdev.bridge.ops;

import java.util.Map;

/**
 * Salt okuma Paper gözlemleri.
 *
 * <p>Arayüz bilinçli olarak Bukkit tiplerinden arındırılmıştır: dispatch ve
 * doğrulama mantığı gerçek bir Minecraft sunucusu olmadan sınanabilsin diye.
 * Bukkit'e dokunan tek yer {@code PaperReadOperations} implementasyonudur.
 *
 * <p>Bu metotların hepsi ana thread'de çağrılır ({@code MainThreadExecutor}).
 */
public interface ReadOperations {

    /** Paper sürümü, build, tick, TPS/MSPT, online oyuncu sayısı. */
    Map<String, Object> serverState();

    /** Yüklü plugin'ler ve enabled durumları. */
    Map<String, Object> pluginList();

    /** Tek plugin metadata'sı. */
    Map<String, Object> pluginGet(String pluginName);

    /** Yüklü dünyalar. */
    Map<String, Object> worldList();

    /** Tek bloğun materyali. */
    Map<String, Object> worldGetBlock(String worldKey, int x, int y, int z);

    /** Test oyuncusunun temel durumu. */
    Map<String, Object> playerState(String playerId);
}
