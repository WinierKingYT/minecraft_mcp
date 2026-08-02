# Master Plan

**Sürüm:** 3.0 (repository'ye taşınmış kısa biçim)
**Durum:** Uygulama için ana sözleşme
**Kanal:** `prototype`

Bu belge yalnızca **kararları ve bağlantıları** tutar. Ayrıntılı bölümler konu dosyalarına taşınmıştır (DOC-GATE-01). Aynı kabul kriteri iki yerde farklı anlamla bulunamaz; çelişki CI hatasıdır.

---

## 1. Normatif dil

| Terim | Anlam |
|---|---|
| **MUST / ZORUNLU** | Uygulama veya release için vazgeçilmez koşul |
| **MUST NOT / YASAK** | Hiçbir varsayılan profilde uygulanmayacak davranış |
| **SHOULD / ÖNERİLEN** | Güçlü varsayılan; sapma ADR gerektirir |
| **MAY / İSTEĞE BAĞLI** | Capability ve profile göre etkinleştirilebilir |
| **V1 dışı** | Tasarımı V1'i karmaşıklaştırmamalı; extension point bırakılabilir |

V1'e giren her özellik şu zincire bağlanmalıdır:

```text
JTBD -> Requirement -> ADR -> Capability -> Epic -> Acceptance Test -> Evidence -> Release Gate
```

İzlenebilirlik matrisi: [`traceability.md`](traceability.md) — DOC-GATE-05 bu dosyayı denetler.

---

## 2. Ürün kararı

Minecraft Plugin Development MCP, yapay zekâ kodlama ajanlarının Paper eklentilerini **gerçek Paper üzerinde derleyip çalıştırmasını**, sınırlandırılmış test eylemleriyle doğrulamasını ve **kanıtlanabilir** başarısızlık raporu üretmesini sağlayan **yerel** geliştirme altyapısıdır.

Kapalı döngü:

```text
 1. Kayıtlı projeyi tanı
 2. Kaynak durumunu değişmez snapshot olarak kaydet
 3. Gradle Wrapper ve bağımlılık bütünlüğünü doğrula
 4. Kaynağı izin verilen execution backend içinde derle
 5. Build artifact'ini checksum ve provenance ile kaydet
 6. Disposable Paper runtime oluştur
 7. Paper, Bridge ve hedef eklentiyi başlat
 8. Runtime'ın gerçekten hazır olduğunu doğrula
 9. Test ortamını deterministik biçimde hazırla
10. Gerekli test eylemlerini uygula
11. Event, log, dünya, oyuncu ve eklenti durumunu doğrula
12. Sonucu yapılandırılmış kanıtlarla raporla
13. Paper ve yardımcı process'leri güvenli biçimde kapat
14. Runtime'ı retention durumuna geçir
15. Hiçbir sahipsiz process, açık port veya korunmasız secret bırakma
```

Ürün tanımı, hedef kullanıcılar ve JTBD: [`product/jtbd.md`](product/jtbd.md)
V1 kapsamı ve kapsam dışı: [`product/scope.md`](product/scope.md)
Başarı ölçütleri: [`product/kpi.md`](product/kpi.md)

### 2.1. Ürün ne olmayacaktır (V1)

- Canlı Minecraft sunucusu yönetim aracı
- Oyunculara açık genel amaçlı AI
- Serbest shell veya serbest konsol erişimi
- Kaynak kod düzenleme aracı
- Genel amaçlı Minecraft botu
- Uzak MCP veya çok kullanıcılı bulut hizmeti

---

## 3. Uyumluluk profili

Tek aktif profil: [`../compatibility/paper-26.2-build-84-v1.yaml`](../compatibility/paper-26.2-build-84-v1.yaml)

| Bileşen | Kilit | Doğrulama |
|---|---|---|
| Minecraft / Paper | `26.2`, STABLE build `84` | ⚠️ pending |
| Paper API | `io.papermc.paper:paper-api:26.2.build.84-stable` | ⚠️ pending |
| Java | runtime & toolchain major `25` | ⚠️ pending |
| Node.js | `24.18.0` LTS | ⚠️ pending |
| Gradle Wrapper | `9.6.1` | ⚠️ pending |
| MCP protokol | `2026-07-28`, taşıma `stdio` | ⚠️ pending |
| Bridge protokol | `1` | n/a |
| Scenario DSL | `1` | n/a |
| Config schema | `1` | n/a |
| Plugin test contract | `1` | n/a |
| Capability registry | `1` | n/a |

**Karar:** Profil `verification.status: unverified` olduğu sürece ürün `prototype` kanalındadır ve D0A kapatılamaz. Doğrulama prosedürü: [`../compatibility/README.md`](../compatibility/README.md)

**Karar (ADR-0005):** V1'in resmî plugin metadata desteği klasik `plugin.yml` içindir; `paper-plugin.yml` feature flag arkasında deneyseldir.

---

## 4. Güvenlik duruşu

Tam threat model: [`security/threat-model.md`](security/threat-model.md)
Garantiler ve garanti edilmeyenler: [`security/guarantees.md`](security/guarantees.md)
Dosya/process/ağ kontrolleri: [`security/controls.md`](security/controls.md)
Supply chain: [`security/supply-chain.md`](security/supply-chain.md)

| Sınıf | Tanım | V1 davranışı |
|---|---|---|
| T0 | Güvenilir geliştirici workspace'i | Trusted Local veya Container |
| T1 | AI üretimli, hatalı fakat kötü niyetli olmayan kod | Container önerilir |
| T2 | Kötü niyetli build script veya plugin | Yalnızca strong isolation hedefi |
| T3 | Host escape / kernel exploit | **V1 garanti etmez** |
| T4 | Canlı production ortamı | **V1 kapsam dışı** |

Vazgeçilmez dürüstlük kuralları (DOC-GATE-06, ADR-0007):

- `trusted-local` backend **hiçbir yerde sandbox olarak adlandırılamaz**.
- Bridge auth, **aynı JVM içindeki aktif kötü niyetli hedef plugin'e karşı güvenlik sınırı değildir**.
- Agent-facing destructive tool V1'de **yoktur**.
- Her güvenlik iddiası ya bir teste ya da açık bir limitation ifadesine bağlıdır.

---

## 5. Process topolojisi

Ayrıntı: [`architecture/process-topology.md`](architecture/process-topology.md) — karar: ADR-0001.

Deployable process'ler:

1. **MCP Server Process** — stdio taşıması, tool facade, policy, scenario koordinasyonu, evidence API
2. **Run Supervisor Process** — trust, snapshot, build, runtime ve process ownership
3. **Paper Server Process** — Paper JAR + Paper Bridge + hedef plugin
4. **Protocol Test Actor Process** — yalnızca M2B capability'leri için (conditional)

Ayrı process **olmayan** bileşenler:

- Paper Bridge → Paper process'i içinde çalışan Java eklentisi
- Policy Engine, Scenario Coordinator, Schema Registry, Evidence API → MCP Server modülleri
- Build Executor, Source Snapshotter, Runtime Registry, Operation Ledger, Garbage Collector → Run Supervisor modülleri

**Karar (ADR-0003):** Process ownership bilgisi Supervisor'da yaşar; MCP Server çökmesi Paper process sahipliğini kaybettirmez.

---

## 6. Kimlikler ve durum makineleri

Ayrıntı: [`architecture/identities.md`](architecture/identities.md), [`architecture/state-machines.md`](architecture/state-machines.md)

Kimlikler: `project_id`, `source_snapshot_id`, `run_id`, `operation_id`, `execution_environment_id`, `build_artifact_id`, `runtime_image_id`, `server_instance_id`, `bridge_boot_id`, `actor_instance_id`, `scenario_run_id`, `mutation_id`, `evidence_id`, `report_id`, `fixture_id`.

**Karar:** Tüm kimlikler tahmin edilemez, sahiplik bağlamına bağlı, audit edilebilir ve açık TTL/retention taşır. **Kimliğe sahip olmak yetki anlamına gelmez** — her çağrıda ownership yeniden doğrulanır.

Run terminal durumları: `COMPLETED`, `FAILED`, `CANCELLED`, `TIMED_OUT`, `DIRTY`, `ORPHANED`, `UNKNOWN_OUTCOME`.

**Karar:** Agent `DELETING` geçişini başlatamaz; runtime silme yalnızca Garbage Collector tarafından, dry-run validation sonrasında yapılır.

---

## 7. Güven, proje kaydı ve snapshot

Ayrıntı: [`architecture/trust-and-snapshot.md`](architecture/trust-and-snapshot.md)

**Karar:** Mutlak path tool girdisi olarak kabul edilmez. Kullanıcı önce projeyi kaydeder; araçlar yalnızca `project_id` alır.

| Trust seviyesi | Açıklama |
|---|---|
| `untrusted` | Build çalıştırılamaz |
| `developer-workspace` | Kullanıcı kayıtlı workspace; Trusted Local veya Container |
| `pinned-source` | Commit/diff fingerprint ile sabitlenmiş kaynak; CI için |
| `approved-fixture` | Ürün repository'sindeki doğrulanmış test fixture |
| `revoked` | Hiçbir operation çalışmaz |

**Karar:** Trust kaydı proje klasörünün **içinde** tutulmaz (proje sahibi kendi trust seviyesini yükseltemez).

Snapshot kuralları: build aynı `source_snapshot_id` üzerinden çalışır; workspace build sırasında değişirse `SOURCE_CHANGED_DURING_BUILD`; symlink default reddedilir; dirty workspace CI profilinde reddedilir.

---

## 8. Execution backend ve izolasyon

Ayrıntı: [`architecture/execution-backends.md`](architecture/execution-backends.md) — karar: ADR-0004.

```text
ExecutionBackend
├─ prepareSource(snapshot)
├─ prepareDependencyCache(profile)
├─ runBuild(buildPlan)
├─ launchPaper(runtimePlan)
├─ launchActor(actorPlan)
├─ collectArtifact(exportPlan)
├─ terminate(processHandle)
└─ destroyEnvironment(environmentHandle)
```

**Karar (kritik):** Runtime, build'den daha zayıf bir güven sınıfında olamaz.

```text
runtime_backend.security_level >= build_backend.security_level
```

Container backend zorunlu kontroller: read-only source mount, disposable writable fs, host secret yok, network policy, CPU/RAM/PID/disk quota, ayrı runtime identity, process tree cleanup, **no privileged container**, **no Docker socket mount**, read-only verified dependency cache, explicit artifact export.

---

## 9. Capability Registry

Ayrıntı: [`contracts/capability-registry.md`](contracts/capability-registry.md)
Kaynak: [`../packages/capability-registry/capabilities/`](../packages/capability-registry/capabilities/)

**Karar:** Capability kayıtları **tek gerçek kaynaktır**. Şunlar bu kayıtlardan üretilir:

- MCP tool definition
- Java enum/DTO
- TypeScript types
- Scenario DSL schema
- Risk matrisi
- Documentation tabloları
- Contract test stub'ları

Elle iki dilde kopyalanan capability veya error tablosu **yasaktır**; drift testi CI hatasıdır.

Risk metadata → R0–R4 türetilir:

```yaml
effect:        read | build | process | mutation | delete
scope:         fixture | disposable_runtime | project | host | production
reversibility: reversible | runtime_discard | snapshot_recoverable | destructive
approval:      none | profile | per_call
exposure:      internal | agent_visible
cost:          low | bounded | high
```

### 9.1. Tool profilleri

**Karar (ADR-0001):** Tool listesi MCP Server başlangıç profiline göre belirlenir; runtime capability durumuna göre araçlar **kaybolmaz**. Eksik capability `CAPABILITY_UNAVAILABLE` döndürür. Aynı profilde tool sırası deterministiktir.

`developer` (varsayılan, agent-facing):

```text
system_health, system_capabilities, project_inspect, project_validate,
plugin_build, plugin_launch, plugin_stop, plugin_diagnose,
operation_get, operation_cancel, scenario_validate, scenario_run, evidence_get
```

`debug`:

```text
runtime_create, runtime_start, runtime_get, runtime_stop, runtime_release,
minecraft_server_get, minecraft_plugin_list, minecraft_plugin_get,
minecraft_world_list, minecraft_world_get_block,
minecraft_events_query, minecraft_player_get
```

`scenario-authoring`:

```text
scenario_step_catalog, fixture_inspect, actor_capabilities,
scenario_validate, scenario_run, evidence_get
```

**İç orkestrasyon araç değildir:** artifact install, runtime directory delete, report export internals, build result polling detail, evidence file path management, Paper process spawn arguments.

---

## 10. MCP sözleşmesi

Ayrıntı: [`contracts/mcp.md`](contracts/mcp.md) — karar: ADR-0002.

**Karar (mutlak):**

```text
stdout    -> yalnızca MCP JSON-RPC mesajları
stderr    -> operational log
file sink -> structured JSON log
```

`console.log` benzeri stdout loglama **yasaktır** ve CI'da stdout purity testiyle kanıtlanır.

Tool sonucu, success/error union'ı üzerinden `structuredContent` taşır. Domain hatası `isError: true` + hata kodu + `retryable` + `suggested_action`. Bilinmeyen tool veya bozuk protokol isteği domain error'a **çevrilmez** — protokol hatası olarak kalır.

Error catalog: [`../packages/error-catalog/errors/`](../packages/error-catalog/errors/) — duplicate kod CI hatasıdır (DOC-GATE-04).

Resources:

```text
minecraft://run/{run_id}/status
minecraft://run/{run_id}/logs
minecraft://run/{run_id}/events
minecraft://run/{run_id}/report
minecraft://run/{run_id}/evidence
minecraft://operation/{operation_id}
minecraft://project/{project_id}/manifest
minecraft://runtime/{server_instance_id}/capabilities
minecraft://artifact/{build_artifact_id}
```

Her resource: MIME type, byte limit, cursor/pagination, ownership kontrolü, redaction, açık TTL. Silinen resource `RESOURCE_NOT_FOUND`. **Raw host path dışarı verilmez.**

---

## 11. Bridge protokolü

Ayrıntı: [`contracts/bridge.md`](contracts/bridge.md)

```text
GET  /v1/health
GET  /v1/capabilities
POST /v1/query
POST /v1/action
GET  /v1/events?boot_id=<id>&after=<sequence>&limit=<n>
```

**Kararlar:** loopback bind; rastgele port; her runtime için farklı token; secret handshake dosyasında **bulunmaz**; Host/Origin/Content-Type/body-size doğrulaması; bounded worker queue; mutation için idempotency key; correlation + causation ID.

Thread modeli: HTTP parsing/auth worker thread'de; Paper API işlemleri uygun scheduler'da; disk/network I/O main thread dışında; mutation run başına seri kuyruk; queue doluysa `BRIDGE_BUSY`. **Read-only sınırlı retry edilebilir; mutation kör retry edilemez.**

---

## 12. Paper plugin keşfi ve test sözleşmesi

Ayrıntı: [`contracts/plugin-test-contract.md`](contracts/plugin-test-contract.md)

`plugin.yml` doğrulaması: `name`, `version`, `main`, `api-version`, main class JAR içinde mevcut mu, dependency/soft-dependency listesi, load order, duplicate plugin name, target Paper API uyumluluğu.

**Karar:** Proje isteğe bağlı `.mcp-minecraft/test-contract.yaml` sağlar. Manifest yoksa build, startup, plugin-enabled, log, generic event ve generic world state testleri çalışır; plugin-specific typed command ve mesaj assertion'ları **açılmaz**.

**Karar:** Native Paper permission attachment desteklenir. LuckPerms/Vault otomatik varsayılmaz; adapter olmayan provider `PERMISSION_PROVIDER_UNSUPPORTED` döndürür.

---

## 13. Determinizm ve fixture

Ayrıntı: [`contracts/determinism.md`](contracts/determinism.md)

**Karar (kritik):** V1'de **scenario başına disposable runtime** kullanılır. Aynı çalışan Paper server `fixture_reset` ile tekrar tekrar sıfırlanmaz. Scenario'lar runtime paylaşmaz.

**Karar:** Sabit uyku (`sleep`) yasaktır; bekleme **eventual assertion** ile yapılır (`within` + `poll_interval`).

Determinism profile: sabit seed, `peaceful`, sabit time/weather, `random_tick_speed: 0`, daylight/weather/mob/patrol/trader/insomnia gamerule'ları kapalı, `online_mode: false`, `spawn_protection: 0`, UTC + UTF-8 + `en_US`.

---

## 14. Test actor stratejisi

Ayrıntı: [`testing/actor-strategy.md`](testing/actor-strategy.md) — karar: ADR-0006.

| Test katmanı | Yöntem |
|---|---|
| Unit | Saf mock / MockBukkit uygun olduğu yerde |
| Bridge contract | Mock client/server |
| Paper integration | Gerçek Paper |
| Server-side setup | Bridge typed operations |
| Gerçek player semantics | Protocol Test Actor |

**Karar:** M2A (server-side) protocol actor gerektirmez ve V1'de koşulsuzdur. M2B (gerçek player semantics) `SPIKE-ACTOR-001` sonucuna bağlıdır:

```text
Spike başarılı        -> M2B V1'de
Kısmen başarılı       -> yalnızca doğrulanan capability'ler V1'de
Başarısız             -> M2B V1.1'e
```

---

## 15. Scenario DSL v1

Ayrıntı: [`contracts/scenario-dsl.md`](contracts/scenario-dsl.md)

**Kararlar:** YAML yalnızca veri; güvenli parser; custom YAML tag yok; include/import yok; **raw command string yok**; step allowlist; capability validation; risk metadata; maksimum step ve timeout; cleanup her terminal durumda denenir.

---

## 16. Event, mutation ve idempotency

Ayrıntı: [`contracts/events-and-mutations.md`](contracts/events-and-mutations.md)

Event cursor `(server_instance_id, bridge_boot_id, sequence)` üçlüsüdür; başka boot'a ait cursor `EVENT_CURSOR_INSTANCE_MISMATCH`.

**Kararlar:** sequence boot içinde monoton; ring buffer bounded; cursor expiry açık hata; **chat varsayılan kapalı**; IP veya kişisel veri kaydedilmez; event schema versioned.

Idempotency: aynı key + aynı argüman → aynı sonuç; aynı key + farklı argüman → `IDEMPOTENCY_KEY_ARGUMENT_MISMATCH`. **`UNKNOWN_OUTCOME` otomatik retry edilmez**; agent önce mutation status sorgular.

---

## 17. Evidence ve provenance

Ayrıntı: [`contracts/evidence.md`](contracts/evidence.md)

```text
source_snapshot_id
  -> execution_environment_id
    -> build_artifact_id
      -> runtime_image_id
        -> server_instance_id
          -> scenario_run_id
            -> evidence_id[]
              -> report_id
```

**Karar:** Bu zincirin tamamlanmaması release gate hatasıdır (KPI-09). Storage: SQLite metadata + content-addressed file store, atomic temp-write + rename, checksums, quota, retention, orphan cleanup. **No raw secret; no absolute host path in public report.**

**Karar:** Cleanup sonucu rapordan ayrı bir alandır; cleanup failure ana test sonucunu **gizlemez** (KPI-12).

---

## 18. Supply chain

Ayrıntı: [`security/supply-chain.md`](security/supply-chain.md)

**Kararlar:** Yalnızca Gradle Wrapper kullanılır; wrapper JAR checksum doğrulanır; `distributionUrl` allowlist + `distributionSha256Sum` zorunlu; dependency locking + `verification-metadata.xml` zorunlu; verification mode `strict`; dynamic version, changing module ve SNAPSHOT release profilinde yasak; Gradle plugin dependency'leri de doğrulanır.

Build modları — **agent serbest Gradle task veremez**:

```yaml
mode: build | unit_test | integration_test | clean_build
```

| Mod | Ağ | Onay | Backend |
|---|---|---|---|
| `provisioning` | repository allowlist | kullanıcı onayı zorunlu | Container zorunlu |
| `reproducible` | kapalı (`--offline`) | yok | herhangi izin verilen |

Provisioning çıktısı **otomatik trusted olmaz**; manuel review bekler.

---

## 19. Yapılandırma

Ayrıntı: [`contracts/config.md`](contracts/config.md)
Şema: [`../packages/config-schema/`](../packages/config-schema/)

**Kararlar:** JSON Schema doğrulaması zorunlu; bilinmeyen property hata üretir; secret config içinde düz metin tutulmaz; Windows ve Linux path davranışı ayrı test edilir; config migration versioned; **güvensiz default bulunmaz**; `allow_agent_destructive_tools: false` V1'de sabittir.

---

## 20. Gözlemlenebilirlik

Ayrıntı: [`operations/observability.md`](operations/observability.md)

Zorunlu metrikler: tool call count/error rate, tool p50/p95/p99, build duration/failure rate, Paper startup duration, runtime crash, orphan recovery, cleanup failure, container quota failure, Bridge queue depth, Bridge timeout, event drop, scenario pass/fail, flaky scenario rate, evidence write failure, evidence storage size, Paper TPS/MSPT.

Maskelenir: Authorization, token, secret file içeriği, host/DB credential, gereksiz environment variable, gereksiz absolute path, IP, oyuncu chat'i, kişisel veri.

---

## 21. Test stratejisi ve kalite kapıları

Ayrıntı: [`testing/strategy.md`](testing/strategy.md), [`testing/security-tests.md`](testing/security-tests.md), [`testing/doc-gates.md`](testing/doc-gates.md)

**Determinizm release gate:** her zorunlu scenario 20 fresh runtime (Linux) + 20 fresh runtime (Windows profili), en az iki bağımsız CI run, failure oranı `%0`, cleanup failure `%0`, orphan `%0`. Beta sonrası son 200 koşuda flaky rate `< %1`.

Doküman kalite kapıları:

| Gate | Konu |
|---|---|
| DOC-GATE-01 | Boyut, bölünme, tekrar; MASTER-PLAN hedefi 600–1.200 satır |
| DOC-GATE-02 | Sürüm/karar placeholder'ı yok; `latest` yok |
| DOC-GATE-03 | JSON/YAML parse, schema validate, Mermaid render, link check |
| DOC-GATE-04 | Duplicate capability/error yok; orphan schema yok |
| DOC-GATE-05 | Her V1 requirement JTBD→gate zincirine bağlı |
| DOC-GATE-06 | Güvenlik dürüstlüğü |

---

## 22. Roadmap

Ayrıntı: [`delivery/roadmap.md`](delivery/roadmap.md), [`delivery/milestone-acceptance.md`](delivery/milestone-acceptance.md), [`delivery/epics.md`](delivery/epics.md)
Spike'lar: [`delivery/spikes/`](delivery/spikes/)

| Aşama | Çıkış | Tahmin |
|---|---|---|
| D0A | Product freeze | 3–5 gün |
| D0B | Feasibility spikes | 7–12 gün |
| D0C | Architecture freeze + go/no-go | 2–3 gün |
| M0 | Stable observation (read-only) | 10–15 gün |
| M1 | Reproducible build and launch | 18–28 gün |
| M2A | Server-side deterministic scenarios | 12–18 gün |
| M2B | Protocol actor scenarios (conditional) | 12–25 gün |
| M3 | Security hardening and beta | 15–25 gün |
| V1 | Stable local release | 5–10 gün stabilization |

Nihai uygulama sırası:

```text
 1. Product and compatibility freeze
 2. Capability and error schemas
 3. MCP stdio + stable tool facade
 4. Run Supervisor skeleton
 5. Paper Bridge read-only
 6. Trust and source snapshot
 7. Gradle supply-chain validation
 8. Execution backends
 9. Reproducible build
10. Disposable Paper runtime
11. Ready gate and evidence
12. M2A deterministic scenarios
13. M2B actor scenarios if gate passes
14. Security hardening
15. Beta on real projects
16. Stable V1 release
```

**Sıranın kritik ilkesi:**

> AI ajanına mutation yetkisi verilmeden önce source provenance, process ownership, disposable runtime, audit, evidence ve cleanup katmanları tamamlanmış olmalıdır.

---

## 23. Risk kaydı

Ayrıntı: [`delivery/risk-register.md`](delivery/risk-register.md)

En yüksek üç risk:

| Risk | Olasılık | Etki | Kontrol |
|---|---|---|---|
| Malicious Gradle / plugin | Orta | Kritik | Container, no network, verification, limitation statement |
| MCP stable 2.x SDK gecikmesi | Orta | Yüksek | Prototype/release ayrımı, transport adapter seam, pin |
| Windows cleanup (orphan process) | Orta | Yüksek | Job Object, Supervisor registry, recovery, CI matrisi |

---

## 24. V1 release gate

Ayrıntı: [`delivery/release-checklist.md`](delivery/release-checklist.md)

V1 koşulları: stable MCP 2.x SDK (veya açık release-blocker çözümü) · P0/P1 closed · no destructive agent tools · no orphan · no path escape · no secret leak · üç gerçek proje · deterministik scenario'lar · install/uninstall · incident response.

---

## 25. V1 sonrası

Ayrıntı: [`delivery/beyond-v1.md`](delivery/beyond-v1.md)

**Yasak genişleme biçimleri:** V1 tool handler içine remote auth eklemek · Paper scheduler içine Folia flag sıkıştırmak · Bridge içine LLM SDK koymak · serbest RCON fallback · hot reload'a güvenmek · live world'ü fixture yapmak · agent'a raw filesystem delete vermek · same-JVM auth'ı saldırgan plugin'e karşı güvenlik sınırı saymak.

---

## 26. Resmî teknik dayanaklar

[`references.md`](references.md) — link checker ve compatibility profile audit'i CI içinde çalışır.
