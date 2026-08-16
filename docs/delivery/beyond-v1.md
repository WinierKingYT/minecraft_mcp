# V1.1 ve sonraki sürümler

## V1.1 adayları

- Maven Wrapper — **kısmen teslim edildi**: doğrulama katmanı + error catalog + testler tamam (ST-MAVEN-001..006); profil `maven:` bölümü ve service/executor bağlantısı ADR + profil yükseltmesi gerektirir (aşağıya bakın)
- macOS
- İkinci Paper profile
- Stable MCP Tasks extension
- Event subscriptions
- Paper plugin experimental desteğinin genişletilmesi
- LuckPerms adapter
- Runtime pool
- Copy-on-write fixture
- Gelişmiş actor inventory
- Performance profiling

### Maven Wrapper — kalan iş

Doğrulama katmanı teslim edildi; aktif kullanım için aşağıdakiler kalır:

1. Uyumluluk profillerine `maven:` bölümü (`wrapper_version`, `distribution_sha256`, `wrapper_jar_sha256`) — DOC-GATE-02 gereği hareketli sürüm ifadesi kullanılamaz, `verify:compatibility` uzatılır.
2. `service.ts project_validate` mvnw tespiti ile Gradle/Maven validator seçimi (mevcut davranış yalnızca Gradle doğrular).
3. `build-executor` Maven planı (`./mvnw package`), container ve artifact selection.
4. `dependency-scan` için Maven lockfile purl desteği.

## V2 adayları

- Remote MCP
- OAuth
- Production observe-only
- Folia adapter
- Fabric
- Bedrock
- Multi-user execution service
- GitHub PR reports
- Compatibility laboratory
- Visual validation
- Distributed evidence store

## Yasak genişleme biçimleri

Aşağıdakiler "küçük bir ekleme" gibi görünüp V1'in güvenlik ve determinizm modelini içeriden bozar. Bir PR bunlardan birini yapıyorsa reddedilir:

| Yasak | Neden |
|---|---|
| V1 tool handler içine remote auth eklemek | Yerel güven modelini sessizce uzak modele çevirir |
| Paper scheduler içine Folia flag sıkıştırmak | İki farklı thread modelini tek kod yolunda gizler |
| Bridge içine LLM SDK koymak | Ana tick içinde ağ/LLM çağrısı; determinizm ve TPS yıkımı |
| Serbest RCON fallback | Kapatılmış olan serbest komut yüzeyini geri açar |
| Hot reload'a güvenmek | Disposable runtime garantisini kanıtlanamaz hâle getirir |
| Live world'ü fixture yapmak | Determinizm ve production non-goal'ünü ihlal eder |
| Agent'a raw filesystem delete vermek | KPI-07 ve GC tekelini ihlal eder |
| Same-JVM auth'ı saldırgan plugin'e karşı güvenlik sınırı saymak | Belgelenmiş limitation'ı yanlış güvenlik iddiasına çevirir (DOC-GATE-06) |
