import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ActorClient, ActorError } from '../src/actor-client.js';

describe('ActorClient', () => {
  describe('createActor', () => {
    it('başarılı actor oluşturma', async () => {
      const mockAction = async (operation: string, args: Record<string, unknown>) => {
        assert.equal(operation, 'test_actor.create');
        assert.equal(args['actor_id'], 'test_player');
        return { success: true, state: { id: 'test_player', uuid: 'uuid-123' } };
      };

      const client = new ActorClient(mockAction);
      const result = await client.createActor({ id: 'test_player' });

      assert.equal(result.success, true);
      assert.equal(result.actor_id, 'test_player');
    });

    it('pozisyon ile actor oluşturma', async () => {
      const position = { world_key: 'minecraft:overworld', x: 10, y: 64, z: 10 };
      const mockAction = async (operation: string, args: Record<string, unknown>) => {
        assert.equal(operation, 'test_actor.create');
        assert.deepEqual(args['position'], position);
        return { success: true };
      };

      const client = new ActorClient(mockAction);
      const result = await client.createActor({ id: 'test_player', position });

      assert.equal(result.success, true);
    });

    it('başarısız oluşturma hatası', async () => {
      const mockAction = async () => {
        return { success: false, message: 'Login başarısız' };
      };

      const client = new ActorClient(mockAction);
      const result = await client.createActor({ id: 'test_player' });

      assert.equal(result.success, false);
      assert.equal(result.message, 'Login başarısız');
    });
  });

  describe('disconnectAll', () => {
    it('tum actorlari baglantindan keser', async () => {
      const mockAction = async (operation: string) => {
        assert.equal(operation, 'test_actor.disconnect_all');
        return {};
      };

      const client = new ActorClient(mockAction);
      await client.disconnectAll();
    });
  });

  describe('breakBlock', () => {
    it('blok kırma komutu gönderir', async () => {
      const position = { world_key: 'minecraft:overworld', x: 10, y: 64, z: 10 };
      const mockAction = async (operation: string, args: Record<string, unknown>) => {
        assert.equal(operation, 'player.break_block');
        assert.equal(args['actor_id'], 'test_player');
        assert.deepEqual(args['position'], position);
        return { success: true };
      };

      const client = new ActorClient(mockAction);
      const result = await client.breakBlock({ actor: 'test_player', position });

      assert.equal(result.success, true);
    });
  });

  describe('move', () => {
    it('hareket komutu gönderir', async () => {
      const position = { world_key: 'minecraft:overworld', x: 20, y: 64, z: 20 };
      const mockAction = async (operation: string, args: Record<string, unknown>) => {
        assert.equal(operation, 'player.move');
        assert.equal(args['actor_id'], 'test_player');
        assert.deepEqual(args['position'], position);
        return { success: true };
      };

      const client = new ActorClient(mockAction);
      const result = await client.move({ actor: 'test_player', position });

      assert.equal(result.success, true);
    });
  });

  describe('look', () => {
    it('yön değiştirme komutu gönderir', async () => {
      const mockAction = async (operation: string, args: Record<string, unknown>) => {
        assert.equal(operation, 'player.look');
        assert.equal(args['actor_id'], 'test_player');
        assert.equal(args['direction'], 'north');
        return { success: true };
      };

      const client = new ActorClient(mockAction);
      const result = await client.look({ actor: 'test_player', direction: 'north' });

      assert.equal(result.success, true);
    });
  });

  describe('chat', () => {
    it('mesaj gönderme komutu', async () => {
      const mockAction = async (operation: string, args: Record<string, unknown>) => {
        assert.equal(operation, 'player.chat');
        assert.equal(args['actor_id'], 'test_player');
        assert.equal(args['message'], 'Hello world!');
        return { success: true };
      };

      const client = new ActorClient(mockAction);
      const result = await client.chat({ actor: 'test_player', message: 'Hello world!' });

      assert.equal(result.success, true);
    });
  });

  describe('pluginCommand', () => {
    it('plugin komutu çalıştırır', async () => {
      const mockAction = async (operation: string, args: Record<string, unknown>) => {
        assert.equal(operation, 'plugin.command');
        assert.equal(args['actor_id'], 'test_player');
        assert.equal(args['command_id'], 'test_command');
        assert.deepEqual(args['arguments'], { key: 'value' });
        return { success: true };
      };

      const client = new ActorClient(mockAction);
      const result = await client.pluginCommand({
        actor: 'test_player',
        command_id: 'test_command',
        arguments: { key: 'value' },
      });

      assert.equal(result.success, true);
    });

    it('argümansız komut çalıştırır', async () => {
      const mockAction = async (operation: string, args: Record<string, unknown>) => {
        assert.equal(operation, 'plugin.command');
        assert.equal(args['actor_id'], 'test_player');
        assert.equal(args['command_id'], 'simple_command');
        assert.equal(args['arguments'], undefined);
        return { success: true };
      };

      const client = new ActorClient(mockAction);
      const result = await client.pluginCommand({
        actor: 'test_player',
        command_id: 'simple_command',
      });

      assert.equal(result.success, true);
    });
  });

  describe('getState', () => {
    it('actor durumunu sorgular', async () => {
      const mockAction = async (operation: string, args: Record<string, unknown>) => {
        assert.equal(operation, 'player.get_state');
        assert.equal(args['actor_id'], 'test_player');
        return {
          found: true,
          id: 'test_player',
          uuid: 'uuid-123',
          position: { world_key: 'minecraft:overworld', x: 10, y: 64, z: 10 },
          gamemode: 'survival',
          health: 20,
          connected: true,
        };
      };

      const client = new ActorClient(mockAction);
      const state = await client.getState('test_player');

      assert.notEqual(state, null);
      assert.equal(state!.id, 'test_player');
      assert.equal(state!.uuid, 'uuid-123');
      assert.equal(state!.gamemode, 'survival');
      assert.equal(state!.health, 20);
      assert.equal(state!.connected, true);
    });

    it('bulunamayan actor için null döner', async () => {
      const mockAction = async () => {
        return { found: false };
      };

      const client = new ActorClient(mockAction);
      const state = await client.getState('nonexistent');

      assert.equal(state, null);
    });
  });
});

describe('ActorError', () => {
  it('hata kodu ve mesajı taşır', () => {
    const error = new ActorError('ACTOR_UNAVAILABLE', 'Actor kullanılamıyor', 'M2B milestone\'ını kontrol edin');

    assert.equal(error.code, 'ACTOR_UNAVAILABLE');
    assert.equal(error.message, 'Actor kullanılamıyor');
    assert.equal(error.suggestedAction, 'M2B milestone\'ını kontrol edin');
    assert.equal(error.name, 'ActorError');
  });

  it('önerilen aksiyon olmadan çalışır', () => {
    const error = new ActorError('ACTOR_CRASHED', 'Actor çöktü');

    assert.equal(error.code, 'ACTOR_CRASHED');
    assert.equal(error.suggestedAction, undefined);
  });
});
