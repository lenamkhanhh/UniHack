#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const server_js_1 = require("./server.js");
async function main() {
    const server = (0, server_js_1.createMissionPayMcpServer)();
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error('Fatal MissionPay MCP server error:', err);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map