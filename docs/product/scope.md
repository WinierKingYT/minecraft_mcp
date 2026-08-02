# V1 kapsamı ve kapsam dışı

## Kapsam içi

### Proje ve kaynak keşfi

- `project_id -> canonical_root` kayıt sistemi
- Trust store
- Git commit ve dirty diff farkındalığı
- Kaynak snapshot manifest'i
- Gradle Wrapper keşfi
- Wrapper JAR ve distribution doğrulaması
- `plugin.yml` keşfi ve doğrulaması
- Java/Paper/API uyumluluk kontrolü
- Build artifact adaylarının deterministik seçimi

### Build

- Yalnızca Gradle Wrapper
- Enum tabanlı build modları
- Shell yorumlaması olmadan process spawn
- Trusted Local ve Container execution backend'leri
- Ayrı Gradle user home
- Dependency locking ve dependency verification
- Network policy, environment allowlist
- CPU, RAM, PID, disk, output ve timeout limitleri
- Yapılandırılmış compiler/test diagnostics
- Artifact checksum ve provenance

### Runtime

- Her run/scenario için disposable runtime
- Paper JAR checksum doğrulaması
- Bridge ve hedef plugin kurulumu
- Deterministik server config
- Ready gate
- PID/process ownership
- Graceful stop ve force termination
- Startup recovery
- Runtime retention ve Supervisor garbage collection

### Minecraft gözlemi

- Server durumu
- Plugin listesi ve ayrıntısı
- Dünya listesi
- Test actor listesi
- Oyuncu temel durumu
- Tek blok sorgusu
- Seçilmiş event'ler
- Redacted runtime logları
- Bridge capabilities

### M2A — server-side testleri

- Plugin enable/config testleri
- Fixture dünya hazırlama
- Server/plugin/log/event/block assertion'ları
- Bridge kontrollü setup mutation'ları
- Disposable runtime per scenario

### M2B — protocol actor testleri (conditional)

`SPIKE-ACTOR-001` başarılı olursa:

- Login/join/quit
- Gerçek oyuncu command
- Native Paper permission context
- Blok kırma
- Basit inventory interaction
- Test actor'a gönderilen mesaj gözlemi

### Raporlama

- JSON report, Markdown report, JUnit XML
- Build log segmentleri
- Event JSONL
- Assertion expected/observed
- Source-to-evidence provenance manifest
- Cleanup sonucu

### MCP

- Yerel `stdio`
- Sabit profile bağlı tool listesi
- Structured output
- MCP Resources
- Inspector smoke testi
- Bir gerçek MCP client compatibility testi

---

## Kapsam dışı

Aşağıdaki maddeler V1 tasarımını **karmaşıklaştırmamalıdır**. En fazla extension point bırakılabilir.

| Kapsam dışı | Not |
|---|---|
| Maven | V1.1 adayı |
| macOS | V1.1 adayı |
| Birden fazla Paper hattı | V1.1 adayı |
| Folia | V2 adayı |
| Fabric, Bedrock | V2 adayı |
| Remote Streamable HTTP, OAuth | V2 adayı |
| MCP Tasks | V1.1 adayı |
| Çok kullanıcılı servis | V2 adayı |
| Canlı sunucu kontrolü | Kalıcı non-goal |
| Production mutation | Kalıcı non-goal |
| Serbest shell | Kalıcı non-goal |
| Serbest RCON | Kalıcı non-goal |
| Serbest Minecraft konsolu | Kalıcı non-goal |
| Genel `execute(command: string)` | Kalıcı non-goal |
| OP, ban veya whitelist yönetimi | Kalıcı non-goal |
| Keyfî proje yolu | Kalıcı non-goal |
| Ekran görüntüsü doğrulama | V2 adayı |
| İnsan gibi survival botu | Kalıcı non-goal |
| Plugin marketine otomatik yayın | Kalıcı non-goal |
| Ana tick içinde LLM çağrısı | Kalıcı non-goal |
| Hedef plugin'i aktif saldırgan kabul ederek tam kanıt bütünlüğü garantisi | Açık limitation — bkz. [`../security/guarantees.md`](../security/guarantees.md) |
