import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionAdapter } from '../src/permission-adapter.js';

function createMockBridge() {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  return {
    action: async (operation: string, args: Record<string, unknown>) => {
      calls.push({ operation, args });
    },
    query: async (operation: string, args: Record<string, unknown>) => {
      calls.push({ operation, args });
      return {
        player: args['player'],
        permission: args['permission'],
        hasPermission: true,
        source: 'default',
      };
    },
    getCalls: () => calls,
  };
}

describe('PermissionAdapter', () => {
  let adapter: PermissionAdapter;

  afterEach(() => {
    adapter?.destroy();
  });

  test('creates adapter with native provider', () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'native', bridgeClient: bridge });
    assert.equal(adapter.provider, 'native');
  });

  test('creates adapter with luckperms provider', () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'luckperms', bridgeClient: bridge });
    assert.equal(adapter.provider, 'luckperms');
  });

  test('attachPermission creates attachment', async () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'native', bridgeClient: bridge });
    const attachment = await adapter.attachPermission('player1', 'test.permission', true);
    assert.ok(attachment.attachmentId.startsWith('perm_'));
    assert.equal(attachment.playerName, 'player1');
    assert.equal(attachment.permission, 'test.permission');
    assert.equal(attachment.value, true);
    assert.equal(attachment.expiresAt, null);
  });

  test('attachPermission with duration', async () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'native', bridgeClient: bridge });
    const attachment = await adapter.attachPermission('player1', 'test.permission', true, 60_000);
    assert.ok(attachment.expiresAt !== null);
    assert.ok(attachment.expiresAt! > Date.now());
  });

  test('attachPermission calls bridge action', async () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'native', bridgeClient: bridge });
    await adapter.attachPermission('player1', 'test.permission', true);
    const calls = bridge.getCalls();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.operation, 'permission.attach');
    assert.equal(calls[0]!.args['player'], 'player1');
    assert.equal(calls[0]!.args['permission'], 'test.permission');
  });

  test('attachPermission calls luckperms action', async () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'luckperms', bridgeClient: bridge });
    await adapter.attachPermission('player1', 'test.permission', true);
    const calls = bridge.getCalls();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.operation, 'luckperms.permission.attach');
  });

  test('detachPermission removes attachment', async () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'native', bridgeClient: bridge });
    const attachment = await adapter.attachPermission('player1', 'test.permission', true);
    await adapter.detachPermission(attachment.attachmentId);
    const permissions = await adapter.getPlayerPermissions('player1');
    assert.equal(permissions.length, 0);
  });

  test('detachPermission throws for non-existent attachment', async () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'native', bridgeClient: bridge });
    await assert.rejects(
      () => adapter.detachPermission('non-existent'),
      /Attachment not found/,
    );
  });

  test('checkPermission returns result', async () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'native', bridgeClient: bridge });
    const result = await adapter.checkPermission('player1', 'test.permission');
    assert.equal(result.player, 'player1');
    assert.equal(result.permission, 'test.permission');
    assert.equal(result.hasPermission, true);
  });

  test('setOp calls bridge action', async () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'native', bridgeClient: bridge });
    await adapter.setOp('player1', true);
    const calls = bridge.getCalls();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.operation, 'player.set_op');
    assert.equal(calls[0]!.args['player'], 'player1');
    assert.equal(calls[0]!.args['value'], true);
  });

  test('getPlayerPermissions returns active attachments', async () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'native', bridgeClient: bridge });
    await adapter.attachPermission('player1', 'test.permission', true);
    await adapter.attachPermission('player1', 'test.permission2', false);
    await adapter.attachPermission('player2', 'test.permission', true);
    const permissions = await adapter.getPlayerPermissions('player1');
    assert.equal(permissions.length, 2);
  });

  test('clearPlayerPermissions removes all for player', async () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'native', bridgeClient: bridge });
    await adapter.attachPermission('player1', 'test.permission', true);
    await adapter.attachPermission('player1', 'test.permission2', false);
    await adapter.attachPermission('player2', 'test.permission', true);
    adapter.clearPlayerPermissions('player1');
    const permissions = await adapter.getPlayerPermissions('player1');
    assert.equal(permissions.length, 0);
    const otherPermissions = await adapter.getPlayerPermissions('player2');
    assert.equal(otherPermissions.length, 1);
  });

  test('emits attached event', async () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'native', bridgeClient: bridge });
    let emitted = false;
    adapter.on('attached', () => { emitted = true; });
    await adapter.attachPermission('player1', 'test.permission', true);
    assert.ok(emitted);
  });

  test('emits detached event', async () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'native', bridgeClient: bridge });
    const attachment = await adapter.attachPermission('player1', 'test.permission', true);
    let emitted = false;
    adapter.on('detached', () => { emitted = true; });
    await adapter.detachPermission(attachment.attachmentId);
    assert.ok(emitted);
  });

  test('destroy clears all attachments', async () => {
    const bridge = createMockBridge();
    adapter = new PermissionAdapter({ provider: 'native', bridgeClient: bridge });
    await adapter.attachPermission('player1', 'test.permission', true);
    adapter.destroy();
    const permissions = await adapter.getPlayerPermissions('player1');
    assert.equal(permissions.length, 0);
  });
});
