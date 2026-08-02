# Dosya sistemi, process ve ağ kontrolleri

## Dosya sistemi

| # | Kural |
|---|---|
| FS-01 | Mutlak path tool input olarak **kabul edilmez** |
| FS-02 | `project_id` registry kullanılır |
| FS-03 | Tüm yollar canonical biçime çevrilir |
| FS-04 | Symlink, junction ve Windows reparse point denetlenir |
| FS-05 | Runtime marker dosyası zorunludur |
| FS-06 | Parent ownership silme öncesi tekrar doğrulanır |
| FS-07 | Delete işlemi dry-run validation olmadan başlamaz |
| FS-08 | Artifact yalnızca doğrulanmış snapshot build output'u altından seçilir |
| FS-09 | Secret file en dar dosya izinleriyle oluşturulur |
| FS-10 | Log okuma byte ve satır limiti taşır |
| FS-11 | Archive extraction traversal test edilir |
| FS-12 | Zip bomb ve aşırı sıkıştırma limiti bulunur |
| FS-13 | Runtime root dışındaki dosyalara delete işlemi yapılamaz |

## Process

| # | Kural |
|---|---|
| PR-01 | **Shell kullanılmaz** |
| PR-02 | Process argüman dizisiyle başlatılır |
| PR-03 | Linux'ta process group; Windows'ta Job Object kullanılır |
| PR-04 | PID yanında executable, process start time ve runtime marker fingerprint saklanır |
| PR-05 | **Bilinmeyen PID körlemesine öldürülmez** |
| PR-06 | Timeout tüm child process tree'ye uygulanır |
| PR-07 | Supervisor startup recovery çalıştırır |
| PR-08 | MCP Server çökmesi Paper process sahipliğini kaybettirmez |
| PR-09 | Port serbestlik kontrolü cleanup kanıtına eklenir |
| PR-10 | Force termination ayrı durum ve audit event üretir |

## Ağ

### Trusted Local

- Provisioning: repository allowlist
- Reproducible build: ağ kapalı hedefi
- Bridge: loopback
- Actor: yalnızca test server portuna erişir

### Container

- Default deny
- Provisioning için açık repository policy
- Paper runtime ağ kapalı
- Host network yok
- Container DNS ve egress kayıt altına alınır
- **Docker socket mount yasaktır**

## Bridge

- Loopback bind
- Her runtime için rastgele token
- Kısa token TTL
- Body, rate ve queue limitleri
- Host/Origin doğrulaması
- Correlation ve causation ID
- Token redaction
- **Same-JVM limitation açıkça belgelenir** — bkz. [`guarantees.md`](guarantees.md)

## Redaction

Maskelenen alanlar:

- `Authorization` header
- Token
- Secret file içeriği
- Host credential
- Veritabanı credential
- Gereksiz environment variable
- Gereksiz absolute path
- IP adresi
- Oyuncu chat'i
- Kişisel veri

Redaction profili evidence manifest'inde `redaction.profile` ve `redaction.removed_fields` alanlarıyla kaydedilir; profilsiz evidence yazılamaz.
