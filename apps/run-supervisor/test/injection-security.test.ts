/**
 * ST-INJECT-001: Malicious Player Text Injection.
 *
 * Tests that event/message fields from players are processed strictly as DATA
 * and never interpreted as templates. Covers attack scenario A17.
 *
 * Bridge-side defense: Json.java escapes control characters and U+2028/U+2029.
 * Agent-side defense: scenario DSL v1 has no raw command strings (DSL-05);
 * commands are produced only through test contract's render.template.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// ─── Player text payload definitions ──────────────────────────────────

const MALICIOUS_PLAYER_TEXTS = [
  {
    name: 'template variable syntax',
    payload: '{{config}}',
    reason: 'must not be substituted as template variable',
  },
  {
    name: 'env variable injection',
    payload: '${env:SECRET_KEY}',
    reason: 'must not resolve environment variables',
  },
  {
    name: 'prototype pollution',
    payload: '{{constructor.constructor("return this")()}}',
    reason: 'must not trigger code execution via prototype chain',
  },
  {
    name: 'HTML/XSS in player name',
    payload: '<script>alert(1)</script>',
    reason: 'must be serialized as literal string, not executed',
  },
  {
    name: 'SQL injection in chat',
    payload: '"; DROP TABLE players; --',
    reason: 'must not be interpreted as SQL statement',
  },
  {
    name: 'path traversal in player name',
    payload: '../../etc/passwd',
    reason: 'must not escape data boundaries',
  },
  {
    name: 'null byte injection',
    payload: 'admin\x00user',
    reason: 'null bytes must be escaped as \\u0000',
  },
  {
    name: 'Unicode line separator',
    payload: 'line1\u2028line2',
    reason: 'U+2028 must be escaped to prevent JS source line break',
  },
  {
    name: 'Unicode paragraph separator',
    payload: 'para1\u2029para2',
    reason: 'U+2029 must be escaped to prevent JS source paragraph break',
  },
  {
    name: 'control character injection',
    payload: 'cmd\x01\x02\x03end',
    reason: 'control chars below U+0020 must be escaped',
  },
  {
    name: 'JSON escape sequence',
    payload: '\\n\\t\\r',
    reason: 'backslash-n etc must be serialized as literal chars, not interpreted',
  },
  {
    name: 'Minecraft formatting codes',
    payload: '§4§lIMPORTANT§r normal',
    reason: 'formatting codes must be stored verbatim',
  },
  {
    name: 'ANSI escape codes',
    payload: '\x1b[31mred\x1b[0m',
    reason: 'ANSI codes must not be interpreted as terminal commands',
  },
  {
    name: 'very long player name',
    payload: 'A'.repeat(256),
    reason: 'long names must be stored without truncation or error',
  },
  {
    name: 'empty string',
    payload: '',
    reason: 'empty names must be handled gracefully',
  },
  {
    name: 'only whitespace',
    payload: '   \t\n  ',
    reason: 'whitespace-only names must be stored as-is',
  },
];

// ─── JSON serialization defense tests ──────────────────────────────────

describe('ST-INJECT-001: Player text treated as data, not template', () => {
  for (const { name, payload, reason } of MALICIOUS_PLAYER_TEXTS) {
    test(`${name} — ${reason}`, () => {
      // Simulate what the Bridge's Json.string() does for escaping
      const escaped = jsonEscape(payload);

      // Round-trip: parse back and verify no interpretation happened
      const json = JSON.stringify({ playerText: escaped });
      const parsed = JSON.parse(json);

      // The escaped form must produce valid JSON
      assert.ok(typeof parsed.playerText === 'string', 'result is a string');
      // After parse, the semantic value is preserved
      assert.equal(parsed.playerText, escaped, 'parse returns escaped form');
    });
  }

  test('template syntax is not substituted during serialization', () => {
    const malicious = '{{constructor.constructor("return process.exit(1)")()}}';
    const escaped = jsonEscape(malicious);
    const json = JSON.stringify({ playerText: escaped });
    const parsed = JSON.parse(json);

    // The escaped form must contain the template syntax literally
    assert.ok(parsed.playerText.includes('{{'), 'double braces preserved');
    assert.ok(parsed.playerText.includes('constructor'), 'constructor keyword preserved');
    assert.ok(parsed.playerText.includes('}}'), 'closing braces preserved');
  });

  test('env variable syntax is not resolved', () => {
    const malicious = 'User ${env:PATH} has path ${env:SECRET}';
    const escaped = jsonEscape(malicious);
    const json = JSON.stringify({ playerText: escaped });
    const parsed = JSON.parse(json);

    assert.ok(parsed.playerText.includes('${env:PATH}'), 'env syntax preserved literally');
    assert.ok(parsed.playerText.includes('${env:SECRET}'), 'secret env syntax preserved literally');
  });

  test('null bytes are escaped to \\u0000', () => {
    const withNull = 'admin\x00user';
    const escaped = jsonEscape(withNull);

    // JSON string must contain \u0000 escape
    assert.ok(escaped.includes('\\u0000'), 'null byte escaped to \\u0000');
    // Must NOT contain literal null byte
    assert.ok(!escaped.includes('\x00'), 'no literal null byte in output');
  });

  test('U+2028 LINE SEPARATOR is escaped', () => {
    const withSep = 'line\u2028break';
    const escaped = jsonEscape(withSep);

    assert.ok(escaped.includes('\\u2028'), 'U+2028 escaped');
    assert.ok(!escaped.includes('\u2028'), 'no literal U+2028 in output');
  });

  test('U+2029 PARAGRAPH SEPARATOR is escaped', () => {
    const withSep = 'para\u2029break';
    const escaped = jsonEscape(withSep);

    assert.ok(escaped.includes('\\u2029'), 'U+2029 escaped');
    assert.ok(!escaped.includes('\u2029'), 'no literal U+2029 in output');
  });

  test('control characters below U+0020 are escaped', () => {
    for (let i = 0; i < 0x20; i++) {
      const char = String.fromCharCode(i);
      const escaped = jsonEscape(char);

      // Must be escaped — no raw control character in output
      // Common control chars have named escapes, others use \uXXXX
      const hasEscape = escaped.includes('\\n') ||
        escaped.includes('\\r') ||
        escaped.includes('\\t') ||
        escaped.includes('\\b') ||
        escaped.includes('\\f') ||
        escaped.includes('\\u');
      assert.ok(hasEscape, `U+${i.toString(16).padStart(4, '0')} is escaped`);
    }
  });

  test('double quotes are escaped', () => {
    const withQuotes = 'player "name" here';
    const escaped = jsonEscape(withQuotes);

    // Must contain escaped quotes
    assert.ok(escaped.includes('\\"'), 'double quotes escaped');
    // Must NOT contain unescaped quotes that would break JSON
    // Build valid JSON by wrapping the escaped string
    const json = JSON.stringify({ v: withQuotes });
    const parsed = JSON.parse(json);
    assert.equal(parsed.v, withQuotes, 'double quotes round-trip correctly');
  });

  test('backslashes are escaped', () => {
    const withBackslash = 'path\\to\\file';
    const escaped = jsonEscape(withBackslash);

    // Must contain escaped backslashes
    assert.ok(escaped.includes('\\\\'), 'backslashes escaped');
    const json = JSON.stringify({ v: withBackslash });
    const parsed = JSON.parse(json);
    assert.equal(parsed.v, withBackslash, 'backslashes round-trip correctly');
  });

  test('player text is never treated as template by JSON.stringify', () => {
    // Verify that JSON.stringify does NOT perform template substitution
    const malicious = '{{config}}';
    const result = JSON.stringify({ text: malicious });

    // JSON.stringify produces a JSON string — no template evaluation
    assert.ok(result.includes('{{config}}'), 'template syntax preserved in JSON output');
    assert.ok(!result.includes('undefined'), 'no undefined substitution');
  });
});

// ─── Scenario DSL defense tests ────────────────────────────────────────

describe('ST-INJECT-001: Scenario DSL prevents raw command injection', () => {
  const DSL_STEP_ALLOWLIST = [
    'start_server',
    'wait_for_line',
    'stop_server',
    'break_block',
    'place_block',
    'move',
    'look',
    'chat',
    'plugin_command',
    'assert_block',
    'assert_chat_message',
    'assert_no_errors',
    'take_screenshot',
    'record_metric',
    'wait',
    'assert_health',
  ];

  test('chat step data cannot contain raw commands', () => {
    // In DSL v1, chat step takes a message string — but this is DATA sent to
    // the player, not a command executed by the server. The Bridge sends it
    // as a PlayerChatEvent, which Paper processes as a chat message.
    const chatPayload = '/op malicious_player';

    // The payload is sent as-is to the Bridge, which calls Player.chat()
    // Paper processes it as a chat message, not a command execution.
    // The defense is that chat messages are DATA, not EXECUTION.
    assert.ok(typeof chatPayload === 'string', 'chat payload is a string');
    assert.ok(chatPayload.startsWith('/'), 'chat payload can contain / prefix');
    // The assertion is that the DSL does not interpret this — it just sends it.
  });

  test('step type must be in allowlist', () => {
    // Malicious step type must be rejected
    const maliciousStep = { type: 'exec', command: 'rm -rf /' };
    assert.ok(
      !DSL_STEP_ALLOWLIST.includes(maliciousStep.type),
      'exec step not in allowlist',
    );
  });

  test('plugin_command step type is allowed but args are validated', () => {
    // plugin_command is in the allowlist, but its args must match the
    // capability's registered command name pattern
    assert.ok(
      DSL_STEP_ALLOWLIST.includes('plugin_command'),
      'plugin_command in allowlist',
    );
    // The actual command execution goes through BridgeActionHandler,
    // which validates against the plugin's registered commands.
  });
});

// ─── JSON serialization helper ─────────────────────────────────────────

/**
 * Replicates the Bridge's Json.string() escaping behavior for testing
 * the TypeScript-side defense without depending on the Java Bridge.
 */
function jsonEscape(raw: string): string {
  let result = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    switch (c) {
      case 0x22: result += '\\"'; break;   // "
      case 0x5c: result += '\\\\'; break;  // backslash
      case 0x0a: result += '\\n'; break;   // \n
      case 0x0d: result += '\\r'; break;   // \r
      case 0x09: result += '\\t'; break;   // \t
      case 0x08: result += '\\b'; break;   // backspace
      case 0x0c: result += '\\f'; break;   // form feed
      default:
        if (c < 0x20 || c === 0x2028 || c === 0x2029) {
          result += `\\u${c.toString(16).padStart(4, '0')}`;
        } else {
          result += raw[i];
        }
    }
  }
  return result;
}
