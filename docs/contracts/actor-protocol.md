# M2B Actor Protocol

Milestone: M2B (koşullu)
Karar: ADR-0006
Spike: SPIKE-ACTOR-001 (kapatıldı, 2026-08-02)

## Genel Bakış

M2B Actor Protocol, test senaryolarında gerçek oyuncu davranışlarını simüle eden altyapıdır. Paper JVM'i içinde NMS (net.minecraft.server) Reflection tabanlı entegrasyon kullanır.

## Mimari

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (TypeScript)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │scenario_run │  │scenario_    │  │actor_capabilities   │ │
│  │             │  │validate     │  │                     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                    │             │
│  ┌──────▼────────────────▼────────────────────▼──────────┐ │
│  │              ScenarioEngine                           │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │ │
│  │  │given steps  │  │when steps   │  │then asserts │   │ │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │ │
│  │         │                │                │           │ │
│  │  ┌──────▼────────────────▼────────────────▼──────────┐│ │
│  │  │           ActorClient / BridgeClient              ││ │
│  │  └──────────────────────┬───────────────────────────┘ │ │
│  └─────────────────────────┼─────────────────────────────┘ │
└────────────────────────────┼───────────────────────────────┘
                             │ IPC (Unix socket / named pipe)
┌────────────────────────────▼───────────────────────────────┐
│                 Run Supervisor (Node.js)                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              BridgeClient (HTTP)                     │  │
│  │  POST /v1/query  (read-only)                        │  │
│  │  POST /v1/action (mutations + actor)                 │  │
│  └──────────────────────┬───────────────────────────────┘  │
└─────────────────────────┼──────────────────────────────────┘
                          │ HTTP loopback
┌─────────────────────────▼──────────────────────────────────┐
│              Paper Bridge Plugin (Java)                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  BridgeHttpServer                                    │  │
│  │  ├─ GET  /v1/health                                  │  │
│  │  ├─ GET  /v1/capabilities                            │  │
│  │  ├─ POST /v1/query  → QueryDispatcher                │  │
│  │  ├─ POST /v1/action → ActionDispatcher               │  │
│  │  └─ GET  /v1/events                                  │  │
│  └──────────────────────┬───────────────────────────────┘  │
│                         │                                  │
│  ┌──────────────────────▼───────────────────────────────┐  │
│  │  ActionDispatcher                                    │  │
│  │  ├─ NmsActorHandler (NMS Reflection)                 │  │
│  │  │  ├─ createActor    → GameProfile + ServerPlayer    │  │
│  │  │  ├─ breakBlock     → BlockPos + NMS               │  │
│  │  │  ├─ move           → Bukkit teleport              │  │
│  │  │  ├─ look           → Yön vektörü                  │  │
│  │  │  ├─ chat           → AsyncPlayerChatEvent         │  │
│  │  │  ├─ pluginCommand  → dispatchCommand              │  │
│  │  │  └─ getState       → Player sorgulama             │  │
│  │  └─ Idempotency Cache                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                         │                                  │
│  ┌──────────────────────▼───────────────────────────────┐  │
│  │  Paper API / NMS                                     │  │
│  │  ├─ Bukkit.createProfile()                           │  │
│  │  ├─ net.minecraft.server.level.ServerPlayer          │  │
│  │  ├─ net.minecraft.core.BlockPos                      │  │
│  │  └─ org.bukkit.entity.Player                         │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

## Bileşenler

### TypeScript (apps/run-supervisor)

#### `actor-client.ts`
Actor komutlarını bridge action endpoint üzerinden çalıştıran istemci.

```typescript
const client = new ActorClient(actionFn);
await client.createActor({ id: 'owner', position: { world_key: 'minecraft:overworld', x: 0, y: 64, z: 0 } });
await client.breakBlock({ actor: 'owner', position: { world_key: 'minecraft:overworld', x: 10, y: 64, z: 10 } });
await client.disconnectAll();
```

#### `bridge-client.ts`
Bridge HTTP istemcisi. `action()` metodu ile mutation'lar ve actor komutları çalıştırılır.

```typescript
const bridge = new BridgeClient(port, token);
await bridge.action('test_actor.create', { actor_id: 'owner' }, idempotencyKey);
```

#### `scenario-engine.ts`
Scenario DSL'ini çalıştırır. Actor adımları için ActorClient kullanır.

- Actor client yoksa `ACTOR_UNAVAILABLE` hatası döner
- Her actor hatası `suggested_action` içerir (KPI-08)

### Java (bridge/paper)

#### `ActionDispatcher`
Mutation ve actor komutlarını ilgili handler'a yönlendirir.

- Idempotency cache desteği
- Mutation'lar için idempotency key zorunlu

#### `NmsActorHandler`
NMS Reflection tabanlı actor handler.

| Method | NMS Sınıfı | Açıklama |
|---|---|---|
| `createActor` | `ServerPlayer` | GameProfile + UUID türetimi |
| `breakBlock` | `BlockPos` | Blok kırma |
| `move` | `Player.teleport` | Hareket |
| `look` | `Location` | Yön değiştirme |
| `chat` | `AsyncPlayerChatEvent` | Mesaj gönderme |
| `pluginCommand` | `dispatchCommand` | Komut çalıştırma |
| `getState` | `Player` | Durum sorgulama |
| `disconnectAll` | `Player.kickPlayer` | Temizlik |

## Bridge Operations

### Query (Read-Only)
| Operation | Risk | Description |
|---|---|---|
| `world.get_block` | R0 | Blok okuma |
| `world.list` | R0 | Dünya listesi |
| `plugin.list` | R0 | Plugin listesi |
| `plugin.get` | R0 | Plugin bilgisi |
| `server.get_state` | R0 | Sunucu durumu |
| `player.get_state` | R0 | Oyuncu durumu |
| `events.query` | R0 | Event sorgulama |
| `logs.query` | R0 | Log sorgulama |

### Action (Mutations)
| Operation | Risk | Idempotency | Description |
|---|---|---|---|
| `world.set_block` | R2 | Zorunlu | Blok yerleştirme |
| `test_actor.create` | R1 | Zorunlu | Actor oluşturma |
| `test_actor.disconnect_all` | R0 | — | Tüm actor'ları kes |
| `player.break_block` | R2 | Zorunlu | Blok kırma |
| `player.move` | R1 | — | Hareket |
| `player.look` | R0 | — | Yön değiştirme |
| `player.chat` | R0 | — | Mesaj gönderme |
| `plugin.command` | R2 | Zorunlu | Komut çalıştırma |

## Scenario DSL Adımları

### M2B Adımları (Actor Gerektiren)
| Adım | Capability | Açıklama |
|---|---|---|
| `test_actor.create` | `test_actor.protocol` | Actor oluşturma |
| `test_actor.disconnect_all` | `actor.disconnect` | Tüm actor'ları kes |
| `player.break_block` | `player.break_block` | Blok kırma |
| `player.move` | `player.state.read` | Hareket |
| `player.look` | `player.state.read` | Yön değiştirme |
| `player.chat` | `actor.message.read` | Mesaj gönderme |
| `plugin.command` | `plugin.command.typed` | Komut çalıştırma |

### Assertion Adımları
| Adım | Capability | Açıklama |
|---|---|---|
| `assert.block` | `world.block.read` | Blok durumu |
| `assert.player_state` | `player.state.read` | Oyuncu durumu |
| `assert.player_message` | `actor.message.read` | Mesaj doğrulama |
| `assert.event` | `events.read` | Event doğrulama |
| `assert.no_log` | `logs.read` | Log doğrulama |
| `assert.plugin_enabled` | `plugin.list` | Plugin durumu |
| `assert.server_state` | `server.state.read` | Sunucu durumu |

## Örnek Scenario

```yaml
version: 1
id: claim-block-break-protection
title: Başkasının claim alanında blok kırılamaz
profile: isolated-test
timeout: 60s

requires:
  capabilities:
    - test_actor.protocol
    - world.block.write
    - player.break_block
    - plugin.command.typed
    - events.read

given:
  - test_actor.create:
      id: owner
      position: { world_key: minecraft:overworld, x: 0, y: 64, z: 0 }
  - test_actor.create:
      id: intruder
      position: { world_key: minecraft:overworld, x: 10, y: 64, z: 10 }
  - world.set_block:
      position: { world_key: minecraft:overworld, x: 10, y: 64, z: 10 }
      material: minecraft:stone
  - plugin.command:
      actor: owner
      command_id: claim_create
      arguments:
        corner1: { x: 0, y: 0, z: 0 }
        corner2: { x: 20, y: 255, z: 20 }

when:
  - player.break_block:
      actor: intruder
      position: { world_key: minecraft:overworld, x: 10, y: 64, z: 10 }

then:
  - assert.block:
      position: { world_key: minecraft:overworld, x: 10, y: 64, z: 10 }
      material: minecraft:stone
      within: 2s
  - assert.event:
      type: block.break
      actor: intruder
      cancelled: true
      within: 5s
  - assert.no_log:
      level_at_least: ERROR

cleanup:
  - test_actor.disconnect_all: {}
```

## Hata Kodları

| Kod | Kategori | Açıklama | Önerilen Aksiyon |
|---|---|---|---|
| `ACTOR_UNAVAILABLE` | environment | Actor kullanılamıyor | `actor_capabilities` ile kontrol edin |
| `ACTOR_LOGIN_FAILED` | state | Giriş başarısız | `online_mode: false` olduğunu doğrulayın |
| `ACTOR_CRASHED` | internal | Actor çöktü | `evidence_get` ile transcript'i inceleyin |
| `PLAYER_NOT_FOUND` | state | Oyuncu bulunamadı | Actor ID'yi kontrol edin |

## Testler

### Unit Testler
- `actor-client.test.ts` — 14 test (ActorClient + ActorError)
- `scenario-parser.test.ts` — 19 test
- `scenario-evidence.test.ts` — 9 test
- `mutation-tracker.test.ts` — 14 test

### Entegrasyon Testleri
- Bridge HTTP server testleri
- ActionDispatcher testleri
- Scenario Engine testleri

## Güvenlik

- Actor yalnızca `online_mode: false` olan test runtime'larında çalışır
- Gerçek kullanıcı hesapları veya production credential kullanılmaz
- Loopback bind (BR-01) ile dış erişim engellenir
- Token doğrulama (BR-03) ile Yetkilendirme
- Idempotency key (BR-08) ile tekrarlanan istek önleme

## Bilinen Sınırlamalar

1. **NMS Reflection:** Paper sürüm değişikliklerinde kırılabilir
2. **Gerçek Oyuncu Spawning:** Şu an skeletal — gerçek `ServerPlayer` oluşturma için NMS constructor erişimi gerekli
3. **Inventory Interaction:** Henüz implemente edilmedi (V1.1)
4. **Message Capture:** Event-based, gerçek Adventure component çözümlemesi henüz değil
5. **Block Break Semantics:** start/abort/finish digging paketleri henüz tam değil

## İlgili Dokümanlar

- [ADR-0006: M2A/M2B Ayrımı](../adr/0006-m2a-m2b-split.md)
- [SPIKE-ACTOR-001: Kapanış](../delivery/spikes/SPIKE-ACTOR-001.md)
- [Bridge Protokolü](../contracts/bridge.md)
- [Scenario DSL](../contracts/scenario-dsl.md)
- [Test Stratejisi](../testing/actor-strategy.md)
