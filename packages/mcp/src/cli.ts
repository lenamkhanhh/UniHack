#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMissionPayMcpServer } from './server.js';

async function main() {
  const server = createMissionPayMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal MissionPay MCP server error:', err);
  process.exit(1);
});
