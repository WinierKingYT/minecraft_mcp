# V1 başarı ölçütleri

| Kimlik | Alan | V1 ölçütü | Doğrulayan gate |
|---|---|---|---|
| KPI-01 | Kurulum | Desteklenen temiz makinede belgelenmiş kurulum tamamlanmalı | M3 |
| KPI-02 | Build | Örnek Gradle Paper projesi tek üst seviye iş akışıyla derlenmeli | M1 |
| KPI-03 | Startup | Paper, Bridge ve hedef plugin ready gate'i geçmeli | M1 |
| KPI-04 | İzolasyon | Her scenario disposable runtime üzerinde çalışmalı | M2A |
| KPI-05 | Tekrarlanabilirlik | Zorunlu scenario'lar fresh runtime'larda deterministik sonuç vermeli | M2A |
| KPI-06 | Process güvenliği | Sahipsiz Paper, Gradle veya actor process'i kalmamalı | M1, M3 |
| KPI-07 | Dosya güvenliği | Kayıtlı kökler dışında yazma ve silme engellenmeli | M1, M3 |
| KPI-08 | Hata kalitesi | Beklenen her hata kod, açıklama ve önerilen aksiyon taşımalı | M1 |
| KPI-09 | Provenance | Her rapor source snapshot'tan evidence'a kadar izlenebilmeli | M1 |
| KPI-10 | MCP uyumluluğu | Inspector ve seçilen gerçek istemciyle temel akış geçmeli | M0 |
| KPI-11 | Güvenlik dürüstlüğü | Trusted Local mod hiçbir yerde sandbox olarak sunulmamalı | DOC-GATE-06 |
| KPI-12 | Cleanup | Cleanup failure ana test sonucunu gizlememeli | M2A |

## Ölçüm notları

- **KPI-05** sayısal tanımı: her zorunlu scenario 20 fresh runtime (Linux) + 20 fresh runtime (Windows profili) üzerinde, en az iki bağımsız CI koşusunda `%0` failure. Ayrıntı: [`../testing/strategy.md`](../testing/strategy.md).
- **KPI-06** ve **KPI-07** negatif testlerle kanıtlanır; "hata görülmedi" yeterli değildir. Ayrıntı: [`../testing/security-tests.md`](../testing/security-tests.md).
- **KPI-11** bir kod ölçütü değil doküman ölçütüdür ve DOC-GATE-06 tarafından otomatik denetlenir.
- **KPI-12** rapor şemasında `result` ve `cleanup` alanlarının ayrı olmasıyla yapısal olarak garanti edilir.
