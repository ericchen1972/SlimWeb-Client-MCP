import { z, type ZodRawShape } from "zod";

import type {
  CatalogSearchInput,
  OrderSummaryInput,
  ProductDetailInput,
  WeblessJson,
} from "./webless-client.js";

export interface ConsumerWeblessClient {
  searchCatalog(input: CatalogSearchInput): Promise<WeblessJson>;
  getProductDetail(input: ProductDetailInput): Promise<WeblessJson>;
  getOrderSummary(input: OrderSummaryInput): Promise<WeblessJson>;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
}

export interface ToolCallResult {
  [key: string]: unknown;
  content: Array<{
    type: "text";
    text: string;
  }>;
}

export interface ToolRegistry {
  listTools(): ToolDefinition[];
  callTool(name: string, args: unknown): Promise<ToolCallResult>;
}

const catalogSearchSchema = {
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(50).optional(),
} satisfies ZodRawShape;

const productDetailSchema = {
  productId: z.string().trim().min(1),
} satisfies ZodRawShape;

const orderLookupSchema = {
  orderToken: z.string().trim().min(1),
} satisfies ZodRawShape;

export function createToolRegistry(client: ConsumerWeblessClient): ToolRegistry {
  const definitions = [
    {
      name: "client_catalog_search",
      title: "Search storefront catalog",
      description: "Search customer-visible Webless storefront catalog data.",
      inputSchema: catalogSearchSchema,
      handler: (args: unknown) =>
        client.searchCatalog(z.object(catalogSearchSchema).parse(args)),
    },
    {
      name: "client_product_detail",
      title: "Get storefront product detail",
      description: "Retrieve customer-visible detail for one storefront product.",
      inputSchema: productDetailSchema,
      handler: (args: unknown) =>
        client.getProductDetail(z.object(productDetailSchema).parse(args)),
    },
    {
      name: "client_order_lookup",
      title: "Look up customer order",
      description: "Retrieve a customer-visible order summary by order token.",
      inputSchema: orderLookupSchema,
      handler: (args: unknown) =>
        client.getOrderSummary(z.object(orderLookupSchema).parse(args)),
    },
  ];

  return {
    listTools() {
      return definitions.map(({ name, title, description, inputSchema }) => ({
        name,
        title,
        description,
        inputSchema,
      }));
    },

    async callTool(name: string, args: unknown) {
      const definition = definitions.find((tool) => tool.name === name);

      if (!definition) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const result = await definition.handler(args);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  };
}
