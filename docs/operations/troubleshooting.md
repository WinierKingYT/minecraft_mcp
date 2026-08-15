# Sorun giderme

Sık karşılaşılan hatalar, olası nedenler ve çözümler. Önce `mcpdev doctor` çalıştırın —
sağlık kontrolü çoğu ortam sorununu adlandırır.

## Doctor check'leri

`mcpdev doctor` şu kontrolleri yapar (10 check):

| Check | Sinyali | Çözüm |
|---|---|---|
| `node_version` | Node pin ile uyumsuz | Pin'li sürümü kur (`status/project-status.yaml` `pins.node`) |
| `java` | Java yok veya major eşleşmiyor | Temurin 25 kur, `JAVA_HOME`'u doğrula |
| `pnpm` | `pnpm not found on PATH` | `npm install -g pnpm`; PATH'e ekle |
| `compatibility_profile` | Profil doğrulanmamış | `verify:compatibility --profile` ile doğrula |
| `mcp_server_binary` / `supervisor_binary` | dist yok | `mcpdev install` veya `pnpm run build` |
| `bridge_jar` | Bridge JAR yok | `bridge/paper` içinde `./gradlew build` |
| `compatibility_profiles` | < 2 verified profil | En az iki profil verified olmalı |
| `capability_registry` | Registry bozuk | `pnpm run gen && pnpm run check:registry` |

## Sık hatalar

### `LOCKFILE_OUT_OF_DATE` (install sırasında)

**Neden:** `package.json` ile `pnpm-lock.yaml` senkron değil; frozen-lockfile hard fail
eder (fallback yok — bkz. `docs/operations/install.md`).

**Çözüm:** `pnpm install` çalıştır, lockfile değişikliğini incele ve commit et.

### `pnpm not found on PATH` (Windows)

**Neden:** pnpm kurulu ama shell PATH'inde yok (genellikle `AppData\Roaming\npm` eksik).

**Çözüm:** `C:\Users\<user>\AppData\Roaming\npm` dizinini `PATH`'e ekle ve shell'i
yeniden başlat. Yükleme: `npm install -g pnpm`.

### `JAVA_VERSION_MISMATCH`

**Neden:** Java major, profile `java.runtime_major` ile eşleşmiyor (V1: 25).

**Çözüm:** Temurin JDK 25 kur ve aktif major'ü doğrula: `java -version`.

### Build/runtime sırasında `JAVA_TOOL_OPTIONS` reddi

**Neden:** Güvenlik denetimi kötü niyetli `-javaagent`/`-agentlib` girişimini tespit
etti (`process-security.test.ts` ST-PROC-002).

**Çözüm:** Ortam değişkenini temizle; projede JVM argümanı gerekiyorsa bunu güvenli
yoldan (build modu) yapın.

### `EULA_NOT_ACCEPTED`

**Neden:** EULA kabulü yalnızca operatör yüzeyinden yapılır (agent kabul edemez).

**Çözüm:** `mcpdev eula accept` çalıştır — kayıt `~/.mcpdev/config/eula.json`'a yazılır.
Detay: `docs/operations/mcp-eula-check.md`.

### `READY_GATE_FAILED` (Paper runtime)

**Neden:** Paper boot süresi ready gate'i aştı veya Bridge plugin yüklenmedi.

**Çözüm:** Paper cache'i kontrol et (`mcpdev doctor`), `--log-level DEBUG` ile serve
ederek Bridge kayıtlarını izle. Soğuk cache ilk koşumda daha yavaştır.

### Orphan process / port tutulması

**Neden:** Runtime temiz kapanmadı (MCP crash, kill).

**Çözüm:** Garbage Collector sahipsiz runtime'ları toplar. Acil durumda
`docs/operations/incident-response.md` "Orphan process" prosedürünü izle.

### Yeni Paper sürümü doğrulanamıyor

**Neden:** Uyumluluk profili yalnızca verified sürümleri kapsar (build 84/87/90).

**Çözüm:** Yeni build'i keşfet, profil ekle, `verify:compatibility --profile` ile doğrula.
Detay: `docs/operations/compatibility-manifest.md`.

### Container testleri skip ediliyor

**Neden:** Windows runner'da Docker daemon güvenilir değil; `MCPDEV_SKIP_DOCKER=1`
canlı Docker testlerini atlar (hermetic argüman testleri yine koşar).

**Çözüm:** Container doğrulaması için Docker kurulu bir Linux ortamı kullan
(`apps/run-supervisor/src/spike-container-check.ts`).

## Köklere ulaşmıyorsa

Bilinçli limitation'lar hata gibi görünebilir — `docs/operations/known-limitations.md`
(bilinçli tasarım kararları) ve `docs/security/guarantees.md` (garanti sınırları) okuyun.
Bunlar kapatılacak bug değil, tasarım kapsamıdır.
