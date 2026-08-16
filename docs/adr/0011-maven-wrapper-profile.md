# ADR-0011 — Maven Wrapper profil bloğu ve project_validate build-system seçimi

**Durum:** superseded by [ADR-0012](0012-maven-profile-model-refactor.md)
**Tarih:** 2026-08-16
**Supersedes:** yok — [ADR-0007](0007-security-claims.md) kapsamını genişletir
**Bağlam:** [`../delivery/beyond-v1.md`](../delivery/beyond-v1.md)

## Bağlam

Maven Wrapper supply-chain doğrulama katmanı (ST-MAVEN-001..006) teslim edildi;
ancak `project_validate` yalnızca Gradle doğruluyordu ve uyumluluk profillerinde
Maven sürüm koordinatı yoktu (DOC-GATE-02 — kod içine gömülü sürüm sabiti
yasak; normatif kaynak profildir). Maven desteğini ayağa kaldırmak için profil
`maven:` bloğu ve service katmanında build-system seçimi gerekliydi.

## Karar

### 1. Profillere `maven:` bloğu eklendi

Üç profil de (build-84, 87, 90) aynı Maven 3.9.16 pinini taşır:

- `maven.wrapper_version: "3.9.16"` — resmî yayın dağıtımı
  (apache-maven-3.9.16-bin.zip).
- `maven.distribution_sha256: "5af3b7…"` — bin.zip SHA-256; archive.apache.org
  ve repo.maven.apache.org'daki `.sha512` kaydıyla birebir teyit edildi
  (SHA-256 doğrudan yayınlanmadığından dağıtım indirilip yerelde hesaplandı).
- `maven.wrapper_jar_sha256: "3d8f20…"` — maven-wrapper-3.3.2.jar (repo.maven.archive.org).
- `maven.distribution_url` + `distribution_url_allowlist` (`repo.maven.apache.org`, `dlcdn.apache.org`).

`verify:compatibility` bu alanları raporlar; `--verify-jar` ile dağıtım
indirilip SHA-256 canlı karşılaştırılır. DOC-GATE-02: hareketli sürüm ifadesi
yok, pin sabittir.

### 2. `project_validate` build sistemini wrapper varlığına göre seçer

`service.ts projectValidate`, `mvnw`/`mvnw.cmd` varlığına göre Maven veya
Gradle validator'ını çağırır. Sonuç `buildSystem: 'gradle' | 'maven'` taşır;
Maven sonucunda `gradleVersion: null`, Gradle sonucunda `mavenVersion: null`'dır.

Maven standardında Gradle'daki `verification-metadata.xml` / `gradle.lockfile`
kuralı yoktur; bu kontroller Gradle'a aittir (docs/security/supply-chain.md).
Maven için `lockFilePresent`/`verificationMetadataPresent` anlamlı değildir ve
`false` döner.

### 3. Build yürütme bu kararın kapsamı dışındadır

Executor (`build-executor`, `trusted-local-backend`, container) hâlâ Gradle'a
sabitlidir. Maven yürütme, no-shell güvenlik modeline (ENV_ALLOWLIST,
canonical path confinement) ayrı dokunacak ayrı bir çalışmadır — bu ADR
yalnızca doğrulama yüzeyini kapsar.

## Alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| Maven sürümünü kod içine gömmek | DOC-GATE-02 / profil-normatif kuralını ihlal eder; profil tek kaynaktır |
| Her iki validator'ı her projede çalıştırmak | Ya `mvnw` ya `gradlew` var olabileceğinden eksik-wrapper bulguları yanlış pozitif üretir; seçim deterministiktir |
| Ayrı `project_validate_maven` tool'u | Capability yüzeyini ikiye ayırır; aynı doğrulama niyeti, tek tool ile `build_system` alanı daha temizdir |
| Maven için sahte lock/verification-metadata üretmek | Belgelediğimiz kapsam farkını ihlal eder; doğrulanmamış yapılandırma iddiası olur |

## Sonuçlar

**Olumlu**

- Maven projeleri `project_validate` ile kendi wrapper'ları üzerinden doğrulanır.
- Profil, Maven 3.9.16 için normatif sürüm+checksum kaynağı oldu; kodda sabit yok.
- Gradle geriye dönük uyumlu: `buildSystem: 'gradle'` mevcut davranışın birebir aynısı.

**Olumsuz**

- `project.validate` capability `version: 2` oldu (MVN_* kodları yüzeyine eklendi).
- `ProjectValidateResult` ve `ProfileGetResult` contract'ları yeni alan taşıyor;
  IPC mock'ları (ipc.test, v11-tools) güncellendi.
- `maven.wrapper_jar_sha256` yalnızca `only-script` dışı projelerde doğrulanabilir;
  `only-script` modulo proje JAR içermez (bulgu değildir).

**Kanıt:** `apps/run-supervisor/test/maven-validation.test.ts`,
`test/ipc.test.ts`, `apps/mcp-server/test/v11-tools.test.ts`,
`scripts/verify-compatibility.mjs`; `pnpm run check` yeşil.

## İlgili

- [ADR-0007](0007-security-claims.md) — doğrulama yüzeyinin güvenlik sınırı
- [`../security/supply-chain.md`](../security/supply-chain.md)
- [`../../compatibility/paper-26.2-build-84-v1.yaml`](../../compatibility/paper-26.2-build-84-v1.yaml)
- [`../delivery/beyond-v1.md`](../delivery/beyond-v1.md)