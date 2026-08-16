# V1.1 ve sonraki sürümler

## V1.1 adayları

- Maven Wrapper — **kısmen teslim edildi**: doğrulama katmanı + error catalog + testler tamam (ST-MAVEN-001..006), profil `maven:` bölümü + `project_validate` `mvnw` tespiti + contract yüzeyi tamam; build yürütme ve dependency-scan purl desteği kaldı (aşağıya bakın)
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

Doğrulama katmanı ve `project_validate` entegrasyonu teslim edildi; aktif kullanım için aşağıdakiler kalır:

1. `build-executor` Maven planı (`./mvnw package`), container ve artifact selection — executor `gradleValidation` bloğuyla Gradle'a sabitlidir; Maven, no-shell güvenlik modeline ayrı dokunacak.
2. `dependency-scan` için Maven lockfile purl desteği.

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
