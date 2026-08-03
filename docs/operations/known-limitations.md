# Bilinen limitationlar

V1'de bilinen ve kasıtlı olan limitationlar. Bunlar hata değil, tasarım kararlarıdır.

> Bu belge [`security/guarantees.md`](../security/guarantees.md) türevidir. Kullanıcıya dönük özet sunar.

## Trusted Local backend

| Limitation | Etkisi | Öneri |
|---|---|---|
| Host izolasyonu sağlamaz | Aynı kullanıcı yetkileriyle çalışan kötü niyetli Gradle plugin'i veya Paper plugin'i host'a erişebilir | Container backend kullanın |
| Sandbox değildir | Trusted Local hiçbir belgede "sandbox" olarak adlandırılamaz (KPI-11) | Tehdit modelini okuyun |

**Test kanıtı:** `ST-PATH-001`, `ST-ENV-001`, `ST-PROC-004`

## Container backend

| Limitation | Etkisi | Öneri |
|---|---|---|
| T3'e (host escape) karşı garanti vermez | Kernel exploit veya container escape başarılı olursa host erişilebilir | Güncel kernel ve container runtime kullanın |
| Docker bağımlılığı | Container backend yalnızca Docker kurulu ortamlarda çalışır | Docker'ın kurulu olduğundan emin olun |

**Test kanıtı:** `ST-CONTAINER-*` serisi

## Bridge authentication

| Limitation | Etkisi | Öneri |
|---|---|---|
| Aynı JVM içindeki kötü niyetli plugin'e karşı tam sınır değil | Hedef plugin, environment değerlerini okuyabilir, runtime dosyalarını değiştirebilir veya loopback endpoint'i kötüye kullanabilir | T2 sınıfı projeleri Container içinde çalıştırın |
| Kanıt bütünlüğü mutlak garanti değil | Saldırgan plugin, kanıt dosyalarını değiştirebilir | Kanıt bütünlüğünü saldırgan plugin'e karşı mutlak garanti olarak sunmayın |

**Test kanıtı:** `ST-SAMEJVM-001`, `ST-SAMEJVM-002`

## Agent yetkileri

| Limitation | Etkisi | Öneri |
|---|---|---|
| V1'de agent-facing destructive tool yok | Agent, raw filesystem delete veya serbest shell erişimi yapamaz | Bu kasıtlı bir güvenlik kararıdır |
| Agent raw filesystem veremez | Runtime silme yalnızca Garbage Collector tarafından yapılır | GC'ye güvenin |
| Agent serbest Gradle task veremez | Yalnızca enum tabanlı build modu (build/unit_test/integration_test/clean_build) | Build modunu belirtin |

## Scenario DSL

| Limitation | Etkisi | Öneri |
|---|---|---|
| Yalnızca `isolated-test` profili | V1'de yalnızca izole test profili desteklenir | Diğer profiller V1.1'de eklenecek |
| Step allowlist sınırlı | 16 adım tipi desteklenir, özel adım eklenemez | Allowed step'ler [contracts/scenario-dsl.md](../contracts/scenario-dsl.md) içinde tanımlıdır |

## Uyumluluk profili

| Limitation | Etkisi | Öneri |
|---|---|---|
| Paper 26.2 build 84 aktif; 87 ve 90 unverified | Yalnızca verified profil (build 84) runtime üretir; 87/90 diverjans içindir ve doğrulanmadan kullanılamaz | `verify:compatibility` ile doğrulayın; yeni sürümler profil eklenerek gelir |
| Java 25 toolchain | Yalnızca Java 25 ile test edilmiştir | Farklı Java sürümleri uyumsuz olabilir |
| Node v24.18.1 | Yalnızca bu Node sürümü ile test edilmiştir | Daha eski sürümler desteklenmeyebilir |

## CI/CD

| Limitation | Etkisi | Öneri |
|---|---|---|
| GitHub Actions bağımlılığı | CI yalnızca GitHub Actions üzerinde çalışır | Diğer CI sistemleri için entegrasyon gerekli |
| Docker bağımlılığı (CI) | Container security testleri Docker gerektirir | Docker kurulu olmayan ortamlarda atlanır |

## Bilinen eksiklikler (V1.1'de ele alınacak)

- MCP SDK bağımlılığı henüz kurulmadı (custom transport devam ediyor)
- `paper-plugin.yml` deneysel desteği kapalı (feature flag ile açılabilir)
- Network verification (Paper JAR checksum doğrulaması) tamamlanmadı
- GC (Garbage Collector) henüz uygulanmadı — runtime dizinleri manuel temizlenmeli
