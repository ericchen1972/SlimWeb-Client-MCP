import { z, type ZodRawShape } from "zod";

import type {
  CatalogSearchInput,
  OrderSummaryInput,
  ProductDetailInput,
  WeblessJson,
} from "./webless-client.js";

export interface ConsumerWeblessClient {
  getCatalogOverview(): Promise<WeblessJson>;
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
  limit: z.number().int().min(1).max(10).optional(),
  minPrice: z.number().int().min(0).optional(),
  maxPrice: z.number().int().min(0).optional(),
  freshness: z.enum(["latest"]).optional(),
  popularity: z.enum(["popular"]).optional(),
  priceOrder: z.enum(["asc", "desc"]).optional(),
} satisfies ZodRawShape;

const catalogOverviewSchema = {} satisfies ZodRawShape;

const productDetailSchema = {
  productId: z.string().trim().min(1),
} satisfies ZodRawShape;

const orderLookupSchema = {
  orderToken: z.string().trim().min(1),
} satisfies ZodRawShape;

export function createToolRegistry(client: ConsumerWeblessClient): ToolRegistry {
  const definitions = [
    {
      name: "client_catalog_overview",
      title: "Get storefront catalog overview",
      description:
        "Retrieve customer-visible storefront category paths and product counts. Use this before product search when the shopper's request is broad or ambiguous, then ask the shopper to choose if multiple categories could match.",
      inputSchema: catalogOverviewSchema,
      handler: () => client.getCatalogOverview(),
    },
    {
      name: "client_catalog_search",
      title: "Search storefront catalog",
      description:
        "Search customer-visible Webless storefront products by product text or category. Optional fields: limit defaults to 3 and must not exceed 10; minPrice and maxPrice filter effective selling price; freshness=latest means recent/new arrivals; popularity=popular means sort by popular products; priceOrder=asc or desc sorts by effective selling price. If the shopper only says a product category, use limit 3 and leave freshness, popularity, and priceOrder unset so the store can return random items. When replying, show each product image from image_url using Markdown image syntax when possible, and include the product_url.",
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
