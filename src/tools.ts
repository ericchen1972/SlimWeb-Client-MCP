import { z, type ZodRawShape } from "zod";

import type {
  CatalogSearchInput,
  OrderSummaryInput,
  ProductDetailInput,
  WeblessJson,
} from "./webless-client.js";
import { PRODUCT_LIST_WIDGET_URI } from "./widgets.js";

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
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface ToolCallResult {
  [key: string]: unknown;
  structuredContent?: WeblessJson;
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
  limit: z.number().int().min(1).max(5).optional(),
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

const catalogSearchOutputSchema = {
  type: "object",
  properties: {
    site: { type: "object" },
    query: { type: "string" },
    filters: { type: "object" },
    items: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          name: { type: "string" },
          image_url: { type: ["string", "null"] },
          product_url: { type: "string" },
          price: { type: "object" },
          regular_price: { type: "object" },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

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
        "Search customer-visible Webless storefront products by product text or category. Optional fields: limit defaults to 3 and must not exceed 5; minPrice and maxPrice filter effective selling price; freshness=latest means recent/new arrivals; popularity=popular means sort by popular products; priceOrder=asc or desc sorts by effective selling price. If the shopper only says a product category, use limit 3 and leave freshness, popularity, and priceOrder unset so the store can return random items. Product results render in the SlimWeb product list widget when supported.",
      inputSchema: catalogSearchSchema,
      outputSchema: catalogSearchOutputSchema,
      annotations: {
        readOnlyHint: true,
      },
      _meta: {
        ui: {
          resourceUri: PRODUCT_LIST_WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": PRODUCT_LIST_WIDGET_URI,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Searching products...",
        "openai/toolInvocation/invoked": "Products ready",
      },
      handler: (args: unknown) =>
        client.searchCatalog(z.object(catalogSearchSchema).parse(args)),
    },
    {
      name: "client_product_detail",
      title: "Get storefront product detail",
      description: "Retrieve customer-visible detail for one storefront product.",
      inputSchema: productDetailSchema,
      _meta: {
        ui: {
          resourceUri: PRODUCT_LIST_WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": PRODUCT_LIST_WIDGET_URI,
        "openai/widgetAccessible": true,
      },
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
      return definitions.map(({ name, title, description, inputSchema, outputSchema, annotations, _meta }) => ({
        name,
        title,
        description,
        inputSchema,
        outputSchema,
        annotations,
        _meta,
      }));
    },

    async callTool(name: string, args: unknown) {
      const definition = definitions.find((tool) => tool.name === name);

      if (!definition) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const result = await definition.handler(args);

      return {
        structuredContent: result,
        content: [
          {
            type: "text",
            text: toolResultText(name, result),
          },
        ],
      };
    },
  };
}

function toolResultText(name: string, result: WeblessJson): string {
  if (name !== "client_catalog_search") {
    return JSON.stringify(result, null, 2);
  }

  const items = Array.isArray(result.items) ? result.items : [];
  if (items.length === 0) {
    return "No matching storefront products were found.";
  }

  return `Found ${items.length} storefront products. Product cards are available in the SlimWeb product list widget.`;
}
