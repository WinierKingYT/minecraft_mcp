# Güvenlik belgeleri

| Belge | İçerik |
|---|---|
| [`threat-model.md`](threat-model.md) | Güvenlik sınıfları, aktörler, güven sınırları, saldırı senaryoları |
| [`guarantees.md`](guarantees.md) | Neyin garanti edildiği, neyin edilmediği — DOC-GATE-06 kaynağı |
| [`controls.md`](controls.md) | Dosya sistemi, process, ağ, Bridge ve redaction kontrolleri |
| [`supply-chain.md`](supply-chain.md) | Gradle wrapper, locking, verification, build modları, Paper JAR |

## Üç kural

Bu belgelerdeki en kritik üç ifade:

1. **`trusted-local` bir sandbox değildir** ve öyle adlandırılamaz.
2. **Bridge auth, aynı JVM içindeki aktif kötü niyetli hedef plugin'e karşı güvenlik sınırı değildir.**
3. **Agent-facing destructive tool V1'de yoktur.**
