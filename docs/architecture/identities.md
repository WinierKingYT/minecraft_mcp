# Kimlikler

| Kimlik | Nesne | Sahip |
|---|---|---|
| `project_id` | Kayıtlı proje | Kullanıcı |
| `source_snapshot_id` | Değişmez kaynak durumu | Supervisor |
| `run_id` | Uçtan uca çalışma | MCP Server |
| `operation_id` | Uzun operation | Supervisor |
| `execution_environment_id` | Local/container çalışma alanı | Supervisor |
| `build_artifact_id` | Derlenmiş JAR | Supervisor |
| `runtime_image_id` | Paper + plugin + config bileşimi | Supervisor |
| `server_instance_id` | Tek Paper process'i | Supervisor |
| `bridge_boot_id` | Bridge'in tek boot örneği | Bridge |
| `actor_instance_id` | Test actor process'i | Supervisor |
| `scenario_run_id` | Scenario yürütme | MCP Server |
| `mutation_id` | Tek mutation | Bridge |
| `evidence_id` | Kanıt nesnesi | Evidence Store |
| `report_id` | Birleşik rapor | MCP Server |
| `fixture_id` | Fixture tanımı | Repository |

## Zorunlu özellikler

Tüm kimlikler:

1. **Tahmin edilemez** — kriptografik rastgelelik içerir; sıralı sayaç kullanılmaz.
2. **Sahiplik bağlamına bağlı** — hangi `run_id`/`project_id` altında geçerli olduğu kayıtlıdır.
3. **Audit edilebilir** — oluşturma, kullanım ve sona erme olayları loglanır.
4. **Açık TTL/retention taşır** — süresi geçmiş kimlik açık hata döndürür, sessizce kabul edilmez.

## Yetkilendirme kuralı

> **Kimliğe sahip olmak yetki anlamına gelmez.**

Her tool çağrısında:

- kimliğin var olup olmadığı,
- çağıran bağlamın o kimliğin sahibi olup olmadığı,
- kimliğin TTL içinde olup olmadığı,
- ilgili nesnenin çağrılan operation için uygun state'te olup olmadığı

ayrı ayrı doğrulanır. Eksik yetki `HANDLE_NOT_OWNED`, süresi geçmiş kimlik `HANDLE_EXPIRED` döndürür.

## Boot ayrımı

`server_instance_id` bir Paper process'ini, `bridge_boot_id` o process içindeki Bridge'in tek boot örneğini tanımlar. Event cursor'ları her ikisini birlikte taşır; başka boot'a ait cursor `EVENT_CURSOR_INSTANCE_MISMATCH` döndürür. Bu ayrım, plugin reload veya Bridge yeniden yüklenme durumlarında eski cursor'ların sessizce yanlış veri döndürmesini engeller.
