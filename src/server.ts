import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { ClientMcpConfig } from "./config.js";
import { WeblessClient } from "./webless-client.js";
import { createToolRegistry, type ToolRegistry } from "./tools.js";

export function createServer(config: ClientMcpConfig): McpServer {
  const server = new McpServer({
    name: "slimweb-client-mcp",
    version: "0.1.0",
  });

  const registry = createToolRegistry(new WeblessClient(config));
  registerConsumerTools(server, registry);

  return server;
}

export function registerConsumerTools(
  server: McpServer,
  registry: ToolRegistry,
): void {
  for (const tool of registry.listTools()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      (args) => registry.callTool(tool.name, args),
    );
  }
}

export async function runStdioServer(config: ClientMcpConfig): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}
