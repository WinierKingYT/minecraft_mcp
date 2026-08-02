import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ActorClient } from '../src/actor-client.js';

function createMockAction(results: Record<string, unknown>[] = []) {
  let callIndex = 0;
  return {
    action: async (operation: string, args: Record<string, unknown>) => {
      const result = results[callIndex++] ?? { success: true };
      return { ...result, operation, args };
    },
    getCallCount: () => callIndex,
  };
}

describe('ActorClient Inventory Methods', () => {
  test('getInventory returns inventory', async () => {
    const mock = createMockAction([{
      items: [{ slot: 0, material: 'DIAMOND_SWORD', amount: 1 }],
      armor: [],
      offhand: null,
      cursor: null,
    }]);
    const client = new ActorClient(mock.action);
    const inventory = await client.getInventory({ actor: 'player1' });
    assert.equal(inventory.actor_id, 'player1');
    assert.equal(inventory.items.length, 1);
    assert.equal(inventory.items[0]!.material, 'DIAMOND_SWORD');
  });

  test('setInventoryItem sets item', async () => {
    const mock = createMockAction([{ success: true, message: 'Item set' }]);
    const client = new ActorClient(mock.action);
    const result = await client.setInventoryItem({
      actor: 'player1',
      slot: 0,
      material: 'DIAMOND_SWORD',
      amount: 1,
    });
    assert.equal(result.success, true);
    assert.equal(result.message, 'Item set');
  });

  test('clearInventory clears inventory', async () => {
    const mock = createMockAction([{ success: true, message: 'Inventory cleared' }]);
    const client = new ActorClient(mock.action);
    const result = await client.clearInventory({ actor: 'player1' });
    assert.equal(result.success, true);
    assert.equal(result.message, 'Inventory cleared');
  });

  test('clearInventory clears specific slot', async () => {
    const mock = createMockAction([{ success: true }]);
    const client = new ActorClient(mock.action);
    await client.clearInventory({ actor: 'player1', slot: 5 });
    assert.equal(mock.getCallCount(), 1);
  });

  test('giveItem gives item', async () => {
    const mock = createMockAction([{ success: true, message: 'Item given' }]);
    const client = new ActorClient(mock.action);
    const result = await client.giveItem({
      actor: 'player1',
      material: 'DIAMOND_SWORD',
      amount: 1,
    });
    assert.equal(result.success, true);
    assert.equal(result.message, 'Item given');
  });

  test('hasItem checks item', async () => {
    const mock = createMockAction([{ has_item: true }]);
    const client = new ActorClient(mock.action);
    const has = await client.hasItem({
      actor: 'player1',
      material: 'DIAMOND_SWORD',
    });
    assert.equal(has, true);
  });

  test('hasItem returns false when not found', async () => {
    const mock = createMockAction([{ has_item: false }]);
    const client = new ActorClient(mock.action);
    const has = await client.hasItem({
      actor: 'player1',
      material: 'DIAMOND_SWORD',
    });
    assert.equal(has, false);
  });

  test('setInventoryItem uses default amount', async () => {
    const mock = createMockAction([{ success: true }]);
    const client = new ActorClient(mock.action);
    await client.setInventoryItem({
      actor: 'player1',
      slot: 0,
      material: 'DIAMOND_SWORD',
    });
    assert.equal(mock.getCallCount(), 1);
  });

  test('giveItem uses default amount', async () => {
    const mock = createMockAction([{ success: true }]);
    const client = new ActorClient(mock.action);
    await client.giveItem({
      actor: 'player1',
      material: 'DIAMOND_SWORD',
    });
    assert.equal(mock.getCallCount(), 1);
  });

  test('getInventory returns empty arrays when no data', async () => {
    const mock = createMockAction([{}]);
    const client = new ActorClient(mock.action);
    const inventory = await client.getInventory({ actor: 'player1' });
    assert.equal(inventory.items.length, 0);
    assert.equal(inventory.armor.length, 0);
    assert.equal(inventory.offhand, null);
    assert.equal(inventory.cursor, null);
  });
});
