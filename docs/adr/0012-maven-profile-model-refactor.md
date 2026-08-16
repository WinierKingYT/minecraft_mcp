# ADR-0012 — Maven profil bloğu: dağıtım ve wrapper sürümlerinin ayrılması

**Durum:** accepted
**Tarih:** 2026-08-16
**Supersedes:** [ADR-0011](0011-maven-wrapper-profile.md) — kararın kapsamı
(kapsayıcı `maven:` bloğu + `project_validate` build-system seçimi) aynı kalır;
yalnızca profil içi alan modeli bu ADR ile değiştirilmiştir.
**Bağlam:** [`../delivery/beyond-v1.md`](../delivery/beyond-v1.md)

## Bağlam

ADR-0011, uyumluluk profilinde `maven:` bloğunu tek `wrapper_version` kavramı
altında tanımladı:

```yaml
maven:
  wrapper_version: "3.9.16"
  wrapper_jar_sha256: "3d8f20…"   # maven-wrapper-3.3.2.jar
```

Bu model iki farklı sürüm hattını tek alanda birleştiriyordu:

- **Apache Maven dağıtımı** (build runtime): `3.9.16` — `distributionUrl` içinden
  çıkarılır ve sürüm uyumluluğu buna karşı kontrol edilir.
- **Maven Wrapper aracı** (launcher tool): `3.3.2` — wrapper JAR'ın sürüm hattı.

`wrapper_version: "3.9.16"` alanı aslında Maven dağıtım sürümünü taşıyordu;
`wrapper_jar_sha256` ise maven-wrapper 3.3.2 yayınının checksum'ını. İleride
"dağıtım yükselt ama wrapper aracını sabit tut" (veya tersi) senaryosu bu
alandan çözülemezdi. Bugün build'i bozmuyordu, ancak domain model borcu
oluşturuyordu; executor yazılmadan düzeltilmesi ucuz, sonrasında pahalıydı.

## Karar

Compatibility profili `maven:` bloğu üç ayrı kavram taşır:

```yaml
maven:
  version: "3.9.16"              # Apache Maven dağıtım sürümü (build runtime)
  distribution:
    url: "https://repo.maven.apache.org/…/apache-maven-3.9.16-bin.zip"
    sha256: "5af3b7…"            # bin.zip SHA-256
    host_allowlist:              # maven-validation allowlist'i (üretim kaynağı)
      - "repo.maven.apache.org"
      - "dlcdn.apache.org"
  wrapper:
    version: "3.3.2"             # Maven Wrapper aracı (launcher tool) — ayrı hat
    jar_sha256: "3d8f20…"        # bilinen-iyi wrapper JAR checksum'ı
```

- `maven.version` + `maven.distribution.*`: dağıtım doğrulamasının
  (MVN_VERSION_INCOMPATIBLE, MVN_DISTRIBUTION_CHECKSUM_*, MVN_DISTRIBUTION_URL_UNAPPROVED)
  tek girdisi.
- `maven.wrapper.*`: wrapper JAR doğrulamasının (MVN_WRAPPER_JAR_UNVERIFIED) tek
  girdisi. `jar_sha256` varlığı, mevcut JAR'ın bilinen-iyi checksum ile
  eşleşmesini zorunlu kılar; `only-script` modda JAR bulunmayabilir (bulgu değildir).
- Eski `wrapper_jar_verification: required` ayracı kaldırıldı: `jar_sha256`
  varlığı doğrulama zorunluluğunu ima eder; ayrı anahtar üçüncü bir kavram
  taşımaz.

`wrapper.mode` ve wrapper script (`mvnw`, `mvnw.cmd`) trust modeli **bu kararın
kapsamı dışındadır**; wrapper yürütme güveni ayrı bir kararla (yürütme ADR'si)
ele alınır.

## Alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| Alan adlarını hiç değiştirmeden sadece yorum eklemek | Borç sadece belgelenmiş olur; yarın `mvnw` wrapper'ı 3.3.3'e güncelleyen profil okunamaz hâle gelir |
| `maven.version` yerine `maven.maven_version` ve `wrapper_version`'u korumak | İki "version" anahtarı karışıklık üretir; `wrapper.version` alt kavramı daha net hiyerarşi verir |
| Yeni bir ADR yerine ADR-0011'i düzenlemek | ADR README kuralı: kabul edilmiş ADR düzenlenmez; değişiklik yeni ADR + `superseded by` ile yapılır |
| Maven dağıtımını Gradle ile aynı düz modelde birleştirmek | Gradle bloğu değişmez; Commit 1 kapsamı Maven modeliyle sınırlıdır, boşuna geniş diff üretmek reddedildi |

## Sonuçlar

**Olumlu**

- "Maven 3.9.17 + Wrapper 3.3.2" gibi bağımsız sürüm hareketleri artık modellenebilir.
- Doğrulama field adları (`maven.version`, `maven.distribution.sha256`,
  `maven.wrapper.jar_sha256`) gerçekte doğrulanan şeyi söyler — `./verify-compatibility` raporu agent için yanıltıcı olmaz.
- Davranışsal değişiklik yok: sürüm pinleri, checksum değerleri ve validator
  kararları birebir aynıdır.

**Olumsuz**

- Üç profil dosyasında alan adı değişikliği: `verified_fields` listeleri ve
  `maven:` bloğu güncellendi; profil değişikliği olduğundan `base_image` /
  gazete taraması gerektirmez, checksum'lar yeniden üretildi.
- `compatibility.ts` `maven?` tipi ve `service.ts` profil bağlama yolu güncellendi;
  pinned `ProfileGetResult.mavenVersion` değeri yine `maven.version`'dan beslenir.

**Kanıt:** `pnpm run check` yeşil; `scripts/verify-compatibility.mjs` yeni alan
adlarıyla çalışır.

## İlgili

- [ADR-0011](0011-maven-wrapper-profile.md) — superseded (kapsama değil, alan modeli)
- [`../../compatibility/paper-26.2-build-84-v1.yaml`](../../compatibility/paper-26.2-build-84-v1.yaml)
- [`../../compatibility/README.md`](../../compatibility/README.md)
- [`apps/run-supervisor/src/compatibility.ts`](../../apps/run-supervisor/src/compatibility.ts)