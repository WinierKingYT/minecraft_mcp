# Risk kaydı

| Risk | Olasılık | Etki | Kontrol | Sahip |
|---|---:|---:|---|---|
| MCP stable 2.x gecikmesi | Orta | Yüksek | Prototype/release ayrımı, transport adapter seam, pin, compatibility suite | MCP |
| Paper değişikliği | Yüksek | Orta | Tek pinned build, checksum, profile | JVM |
| Actor instability | Yüksek | Orta/Yüksek | M2A/M2B ayrımı | QA/JVM |
| Windows cleanup | Orta | Yüksek | Job Object spike ve CI | Runtime |
| Malicious Gradle | Orta | Kritik | Container, no network, verification | Security |
| Malicious plugin | Orta | Kritik | Paper runtime isolation, limitation statement | Security |
| Same-JVM Bridge bypass | Orta | Yüksek | Threat boundary, container, evidence caveat | JVM/Security |
| Flaky tests | Yüksek | Orta | Fresh runtime, eventual assertions | QA |
| Source changes mid-build | Orta | Yüksek | Snapshot and fingerprint | Runtime |
| Dependency compromise | Orta | Kritik | Lock, verification, checksum, SBOM | Build |
| Orphan process | Orta | Yüksek | Supervisor, registry, recovery | Runtime |
| Evidence corruption | Düşük/Orta | Yüksek | Content address, atomic write, checksum | Platform |
| Tool surface overload | Orta | Orta | Stable profiles, high-level tools | MCP |
| Disk exhaustion | Orta | Orta | Quota, retention, GC | Platform |
| Runtime escape | Düşük/Orta | Kritik | Container hardening, no privileged/socket | Security |

## Bootstrap sırasında eklenen risk

| Risk | Olasılık | Etki | Kontrol | Sahip |
|---|---:|---:|---|---|
| **Uyumluluk profili koordinatlarının gerçekte var olmaması** | Orta | Yüksek | `verification.status: unverified` gate'i; D0A kapanmadan doğrulama zorunlu; `paper.api_coordinate` biçimi özellikle şüpheli | Product |

Bu risk, profildeki sürümlerin (Paper build, Paper API Maven koordinatı, MCP protokol revizyonu, alpha SDK sürümleri) V3 belgesinden alınıp canlı kaynaktan **teyit edilmeden** repository'ye yazılmasından doğar. Doğrulama yapılmadan M0'a geçilirse, tüm build ve runtime katmanı var olmayan bir koordinat üzerine kurulur.
