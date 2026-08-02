/**
 * CT-MCP-TOOLSURFACE-001 — M0 demosunun ikinci yarısı.
 *
 * Demo tanımı (docs/delivery/roadmap.md M0):
 *   "... hiçbir mutation aracı developer profile'da görünmez."
 *
 * Bu, capability registry'deki bir kuralın (ADR-0007) MCP yüzeyinde gerçekten
 * uygulandığını doğrular. Registry doğrulaması `validate-registry.mjs` içinde
 * ayrıca yapılır; burada üretilen tiplerin üzerinden son yüzey denetlenir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, TOOL_PROFILES, TOOL_TO_CAPABILITY, DEFAULT_TOOL_PROFILE } from '@mcpdev/generated-types';

test('developer varsayılan profildir', () => {
  assert.equal(DEFAULT_TOOL_PROFILE, 'developer');
});

test('developer profilinde hiçbir mutation veya delete aracı yoktur', () => {
  const offenders: string[] = [];

  for (const tool of TOOL_PROFILES.developer) {
    const capabilityId = TOOL_TO_CAPABILITY[tool];
    assert.ok(capabilityId, `"${tool}" bir capability kaydına bağlı olmalı`);

    const capability = CAPABILITIES[capabilityId];
    if (capability.risk.effect === 'mutation' || capability.risk.effect === 'delete') {
      offenders.push(`${tool} -> ${capabilityId} (${capability.risk.effect})`);
    }
  }

  assert.deepEqual(offenders, [], 'developer profili mutation/delete aracı içeremez');
});

test('R3 ve R4 capability’leri hiçbir profilde agent yüzeyine çıkmaz', () => {
  const offenders: string[] = [];

  for (const [profileName, tools] of Object.entries(TOOL_PROFILES)) {
    for (const tool of tools as readonly string[]) {
      const capabilityId = TOOL_TO_CAPABILITY[tool];
      if (!capabilityId) continue;
      const level = CAPABILITIES[capabilityId].risk.level;
      if (level === 'R3' || level === 'R4') {
        offenders.push(`${profileName}:${tool} (${level})`);
      }
    }
  }

  assert.deepEqual(offenders, [], 'ADR-0007: R3/R4 agent-facing olamaz');
});

test('runtime.delete hiçbir profilde bulunmaz', () => {
  // Silme yalnızca Garbage Collector'a aittir; agent DELETING başlatamaz.
  assert.equal(CAPABILITIES['runtime.delete'].risk.level, 'R4');
  assert.equal(CAPABILITIES['runtime.delete'].developerTool, null);
  assert.equal(CAPABILITIES['runtime.delete'].debugTool, null);

  for (const tools of Object.values(TOOL_PROFILES)) {
    for (const tool of tools as readonly string[]) {
      assert.notEqual(TOOL_TO_CAPABILITY[tool], 'runtime.delete');
    }
  }
});

test('world.block.write yalnızca DSL üzerinden erişilebilir', () => {
  const capability = CAPABILITIES['world.block.write'];

  assert.equal(capability.risk.effect, 'mutation');
  assert.equal(capability.developerTool, null, 'mutation agent aracı olamaz');
  assert.equal(capability.debugTool, null);
  assert.equal(capability.dslStep, 'world.set_block', 'yalnızca scenario bağlamında');
});

test('her profildeki her tool bir capability kaydına bağlıdır', () => {
  for (const [profileName, tools] of Object.entries(TOOL_PROFILES)) {
    for (const tool of tools as readonly string[]) {
      assert.ok(
        TOOL_TO_CAPABILITY[tool],
        `${profileName} profilindeki "${tool}" capability kaydına bağlı değil`,
      );
    }
  }
});
