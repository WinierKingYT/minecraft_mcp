/**
 * Test fixture — sahte MCP Server.
 *
 * Serve launcher'ın mcp-server zincirini (exit code yansıması, kapanış
 * sıralaması) test etmek için kullanılır; protokol konuşmaz.
 *
 * Ortam:
 *   FAKE_MCP_EXIT     — exit code (varsayılan 0)
 *   FAKE_MCP_DELAY_MS — çıkış öncesi bekleme (varsayılan 300)
 */

const exitCode = Number.parseInt(process.env['FAKE_MCP_EXIT'] ?? '0', 10);
const delayMs = Number.parseInt(process.env['FAKE_MCP_DELAY_MS'] ?? '300', 10);

setTimeout(() => process.exit(exitCode), delayMs);
