package io.github.mcpdev.bridge.ops;

import java.util.Map;

/**
 * Dünya mutation'ları — world.set_block ve world.set_chunk_ticket.
 *
 * <p>Arayüz bilinçli olarak Bukkit tiplerinden arındırılmıştır: doğrulama
 * mantığı gerçek bir Minecraft sunucusu olmadan sınanabilsin diye. Bukkit'e
 * dokunan tek yer {@code PaperWorldMutations} implementasyonudur.
 *
 * <p>Tüm metotlar ana thread'de çağrılır ({@code MainThreadExecutor}).
 */
public interface WorldMutations {

    /**
     * Fixture bölgesi içinde tek bir bloğu, izin verilen materyal listesinden
     * bir değere ayarlar.
     *
     * @throws BridgeOperationException bölge dışı (REGION_NOT_ALLOWED), izinsiz
     *         materyal (MATERIAL_NOT_ALLOWED), yüksüz chunk (CHUNK_NOT_LOADED)
     */
    Map<String, Object> setBlock(String worldKey, int x, int y, int z, String material);

    /**
     * Fixture bölgesini açık chunk ticket'ı ile yüklü tutar — okuyan
     * operation'lar chunk YÜKLETMEZ (contracts/determinism.md).
     *
     * @param radius ticket çevresindeki chunk yarıçapı (1 = 3x3); limit 4
     */
    Map<String, Object> setChunkTicket(String worldKey, int x, int z, int radius);
}
