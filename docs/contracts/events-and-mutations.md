# Event, mutation ve idempotency modeli

## Event cursor

```json
{
  "server_instance_id": "srv_...",
  "bridge_boot_id": "boot_...",
  "sequence": 1042
}
```

Başka boot'a ait cursor `EVENT_CURSOR_INSTANCE_MISMATCH` döndürür. Sessiz sıfırlama yapılmaz: eski cursor'ı yeni boot'ta kabul etmek, ajanın kaçırdığı event'leri görmüş sanmasına yol açar.

## Event schema

```json
{
  "sequence": 1042,
  "event_id": "evt_...",
  "type": "block.break",
  "run_id": "run_...",
  "server_instance_id": "srv_...",
  "bridge_boot_id": "boot_...",
  "correlation_id": "cor_...",
  "causation_id": "mutation_...",
  "server_tick": 8201,
  "occurred_at": "2026-07-29T12:00:00.100Z",
  "actor": {
    "kind": "test_player",
    "id": "intruder"
  },
  "data": {
    "cancelled": true,
    "world_key": "minecraft:overworld",
    "x": 10,
    "y": 64,
    "z": 10
  },
  "source": "paper"
}
```

## Event kuralları

| # | Kural |
|---|---|
| EV-01 | Sequence boot içinde monoton |
| EV-02 | Ring buffer bounded |
| EV-03 | Cursor expiry açık hata |
| EV-04 | **Chat varsayılan kapalı** |
| EV-05 | **IP veya kişisel veri kaydedilmez** |
| EV-06 | Duplicate listener event testi bulunur |
| EV-07 | Event schema versioned |
| EV-08 | Scenario yalnızca kendi causation/correlation zincirini tercih eder |

EV-08 gerekçesi: aynı runtime'da Bridge'in kendi eylemleri de event üretir. Assertion'ın yanlış event'i eşleştirmesi, geçen ama yanlış bir test üretir — bu, başarısız testten daha tehlikelidir.

## Mutation ledger

```json
{
  "mutation_id": "mut_...",
  "idempotency_key": "idem_...",
  "operation": "world.set_block",
  "arguments_sha256": "sha256:...",
  "state": "APPLIED",
  "result_sha256": "sha256:...",
  "server_tick": 4812,
  "created_at": "...",
  "completed_at": "..."
}
```

## Idempotency kuralları

| # | Kural |
|---|---|
| ID-01 | Aynı key aynı argümanla aynı sonucu döndürür |
| ID-02 | Aynı key farklı argümanla `IDEMPOTENCY_KEY_ARGUMENT_MISMATCH` |
| ID-03 | Bridge restart sonrası ledger runtime evidence alanından restore edilir |
| ID-04 | **`UNKNOWN_OUTCOME` otomatik retry edilmez** |
| ID-05 | Agent önce mutation status sorgular |

ID-02 varlığı önemlidir: yalnızca key'e bakan bir idempotency uygulaması, ajanın key'i yeniden kullanmasını sessizce kabul eder ve ikinci mutation hiç uygulanmadan "başarılı" döner.
