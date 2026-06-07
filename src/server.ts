import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { ClientMcpConfig } from "./config.js";
import { WeblessClient } from "./webless-client.js";
import { createToolRegistry, type ToolRegistry } from "./tools.js";
import {
  productImagesWidgetContents,
  productImagesWidgetResource,
  PRODUCT_IMAGES_WIDGET_URI,
  productListWidgetContents,
  productListWidgetResource,
  PRODUCT_LIST_WIDGET_URI,
} from "./widgets.js";

export function createServer(config: ClientMcpConfig): McpServer {
  const server = new McpServer({
    name: "slimweb-client-mcp",
    version: "0.1.0",
  });

  const registry = createToolRegistry(new WeblessClient(config));
  registerConsumerResources(server);
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
        annotations: tool.annotations as never,
        _meta: tool._meta,
      },
      (args) => registry.callTool(tool.name, args),
    );
  }
}

export function registerConsumerResources(server: McpServer): void {
  const resource = productListWidgetResource();

  server.registerResource(
    "slimweb_product_list_widget",
    PRODUCT_LIST_WIDGET_URI,
    {
      title: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    },
    async () => ({
      contents: [productListWidgetContents()],
    }),
  );

  const imageResource = productImagesWidgetResource();

  server.registerResource(
    "slimweb_product_images_widget",
    PRODUCT_IMAGES_WIDGET_URI,
    {
      title: imageResource.name,
      description: imageResource.description,
      mimeType: imageResource.mimeType,
    },
    async () => ({
      contents: [productImagesWidgetContents()],
    }),
  );
}

export async function runStdioServer(config: ClientMcpConfig): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}
