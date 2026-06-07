import { z, type ZodRawShape } from "zod";

import type {
  CatalogSearchInput,
  CheckoutStartInput,
  CheckoutStatusInput,
  OrderListInput,
  OrderPreviewInput,
  ProductDetailInput,
  ProductVerifyInput,
  WeblessJson,
} from "./webless-client.js";
import { PRODUCT_IMAGES_WIDGET_URI, PRODUCT_LIST_WIDGET_URI } from "./widgets.js";

export interface ConsumerWeblessClient {
  getCatalogOverview(): Promise<WeblessJson>;
  searchCatalog(input: CatalogSearchInput): Promise<WeblessJson>;
  getProductDetail(input: ProductDetailInput): Promise<WeblessJson>;
  verifyProduct(input: ProductVerifyInput): Promise<WeblessJson>;
  getOrderList(input: OrderListInput): Promise<WeblessJson>;
  getCustomerContext(): Promise<WeblessJson>;
  getOrderPreview(input: OrderPreviewInput): Promise<WeblessJson>;
  startCheckout(input: CheckoutStartInput): Promise<WeblessJson>;
  getCheckoutStatus(input: CheckoutStatusInput): Promise<WeblessJson>;
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

export interface AuthStatus extends WeblessJson {
  authenticated: boolean;
  customer: {
    id: number;
    email: string;
    google_id: string;
  };
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

const productCardsSchema = {
  productIds: z.array(z.string().trim().min(1)).min(1).max(5),
} satisfies ZodRawShape;

const productVerifySchema = {
  productId: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(99).optional(),
} satisfies ZodRawShape;

const orderListSchema = {
  status: z.enum(["all", "pending", "completed"]).default("all").optional(),
  limit: z.number().int().min(1).max(20).optional(),
} satisfies ZodRawShape;

const customerContextSchema = {} satisfies ZodRawShape;

const orderPreviewSchema = {
  items: z.array(z.object({
    productId: z.number().int().min(1),
    quantity: z.number().int().min(1).max(99),
  })).min(1).max(10),
  buyerName: z.string().trim().min(1),
  buyerPhone: z.string().trim().min(1),
  recipientName: z.string().trim().min(1),
  recipientPhone: z.string().trim().min(1),
  recipientAddress: z.string().trim().min(1),
} satisfies ZodRawShape;

const checkoutStartSchema = {
  ...orderPreviewSchema,
  paymentMethod: z.enum(["online", "pickup_pay", "cod"]),
  logisticsMethod: z.enum(["home_delivery", "cvs_pickup"]),
  reusePreviousStore: z.boolean().optional(),
  confirmBeforeCreate: z.boolean().optional(),
} satisfies ZodRawShape;

const checkoutStatusSchema = {
  checkoutToken: z.string().trim().min(1),
} satisfies ZodRawShape;

const productProperties = {
  id: { type: "number" },
  sku: { type: ["string", "null"] },
  name: { type: "string" },
  slug: { type: ["string", "null"] },
  summary: { type: ["string", "null"] },
  category: { type: "object" },
  image_url: { type: ["string", "null"] },
  image_count: { type: "number" },
  has_image_gallery: { type: "boolean" },
  product_url: { type: "string" },
  price: { type: "object" },
  regular_price: { type: "object" },
} satisfies Record<string, unknown>;

const catalogOverviewOutputSchema = {
  type: "object",
  properties: {
    site: { type: "object" },
    categories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          name: { type: "string" },
          path: { type: "array", items: { type: "string" } },
          product_count: { type: "number" },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

const authStatusOutputSchema = {
  type: "object",
  properties: {
    authenticated: { type: "boolean" },
    customer: { type: "object" },
  },
} satisfies Record<string, unknown>;

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
        properties: productProperties,
      },
    },
  },
} satisfies Record<string, unknown>;

const productCardsOutputSchema = {
  type: "object",
  properties: {
    site: { type: "object" },
    items: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: productProperties,
      },
    },
  },
} satisfies Record<string, unknown>;

const productDetailOutputSchema = {
  type: "object",
  properties: {
    site: { type: "object" },
    product: {
      type: "object",
      properties: productProperties,
    },
  },
} satisfies Record<string, unknown>;

const productImagesOutputSchema = {
  type: "object",
  properties: {
    site: { type: "object" },
    product: {
      type: "object",
      properties: productProperties,
    },
    images: {
      type: "array",
      items: { type: "object" },
    },
  },
} satisfies Record<string, unknown>;

const productVerifyOutputSchema = {
  type: "object",
  properties: {
    site: { type: "object" },
    requested: { type: "object" },
    available: { type: "boolean" },
    reason: { type: ["string", "null"] },
    product: { type: "object" },
  },
} satisfies Record<string, unknown>;

const orderListOutputSchema = {
  type: "object",
  properties: {
    site: { type: "object" },
    filters: { type: "object" },
    orders: {
      type: "array",
      items: { type: "object" },
    },
  },
} satisfies Record<string, unknown>;

const customerContextOutputSchema = {
  type: "object",
  properties: {
    site: { type: "object" },
    customer: { type: "object" },
    last_order: { type: ["object", "null"] },
  },
} satisfies Record<string, unknown>;

const orderPreviewOutputSchema = {
  type: "object",
  properties: {
    site: { type: "object" },
    preview: { type: "object" },
  },
} satisfies Record<string, unknown>;

const checkoutOutputSchema = {
  type: "object",
  properties: {
    site: { type: "object" },
    checkout: { type: "object" },
  },
} satisfies Record<string, unknown>;

export function createToolRegistry(
  client: ConsumerWeblessClient,
  authStatus?: AuthStatus,
): ToolRegistry {
  const definitions = [
    {
      name: "client_auth_status",
      title: "Get SlimWeb client login status",
      description:
        "Return the authenticated SlimWeb-Client customer status for this site MCP connection.",
      inputSchema: {} satisfies ZodRawShape,
      outputSchema: authStatusOutputSchema,
      handler: () => authStatus ?? {
        authenticated: false,
        customer: {
          id: 0,
          email: "",
          google_id: "",
        },
      },
    },
    {
      name: "client_catalog_overview",
      title: "Get storefront catalog overview",
      description:
        "Retrieve customer-visible storefront category paths and product counts. Use this before product search when the shopper's request is broad or ambiguous, then ask the shopper to choose if multiple categories could match.",
      inputSchema: catalogOverviewSchema,
      outputSchema: catalogOverviewOutputSchema,
      handler: () => client.getCatalogOverview(),
    },
    {
      name: "client_catalog_search",
      title: "Search storefront recommendation candidates",
      description:
        "Search customer-visible Webless storefront products as recommendation candidates for the model to inspect. This tool returns structured candidate data only and does not render product cards. For recommendations, request a broader candidate pool, usually limit 5 unless the shopper's constraints are very specific, then choose the final products yourself based on the conversation and shopper preferences. If the shopper specifies a final count, select exactly that many products; otherwise select 2. After selecting, call client_product_cards with the chosen productIds to render only the final recommended products. minPrice and maxPrice filter effective selling price; freshness=latest means recent/new arrivals; popularity=popular means sort by popular products; priceOrder=asc or desc sorts by effective selling price.",
      inputSchema: catalogSearchSchema,
      outputSchema: catalogSearchOutputSchema,
      annotations: {
        readOnlyHint: true,
      },
      handler: (args: unknown) =>
        client.searchCatalog(z.object(catalogSearchSchema).parse(args)),
    },
    {
      name: "client_product_cards",
      title: "Show selected storefront product cards",
      description:
        "Render product cards for products the model has already selected from candidate results. Use this after client_catalog_search when making recommendations so the widget displays only the final recommended productIds, not the whole candidate pool.",
      inputSchema: productCardsSchema,
      outputSchema: productCardsOutputSchema,
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
        "openai/toolInvocation/invoking": "Loading selected products...",
        "openai/toolInvocation/invoked": "Products ready",
      },
      handler: async (args: unknown) => {
        const input = z.object(productCardsSchema).parse(args);
        const details = await Promise.all(
          input.productIds.map((productId) => client.getProductDetail({ productId })),
        );
        const firstSite = details.find((detail) => detail.site)?.site;

        return {
          site: firstSite && typeof firstSite === "object" ? firstSite : {},
          items: details.flatMap((detail) => {
            const product = productDetailForModel(detail).product;
            return product && typeof product === "object" && !Array.isArray(product)
              ? [product as Record<string, unknown>]
              : [];
          }),
        };
      },
    },
    {
      name: "client_product_detail",
      title: "Get storefront product detail",
      description: "Retrieve customer-visible detail for one storefront product.",
      inputSchema: productDetailSchema,
      outputSchema: productDetailOutputSchema,
      _meta: {
        ui: {
          resourceUri: PRODUCT_LIST_WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": PRODUCT_LIST_WIDGET_URI,
        "openai/widgetAccessible": true,
      },
      handler: async (args: unknown) =>
        productDetailForModel(await client.getProductDetail(z.object(productDetailSchema).parse(args))),
    },
    {
      name: "client_product_images",
      title: "Show storefront product images",
      description:
        "Display customer-visible images for one storefront product in a SlimWeb image gallery widget. Use this when the shopper asks to see detailed product photos, angles, product-description images, movement photos, or close-up images. Do not merely describe that images exist; call this tool to render them.",
      inputSchema: productDetailSchema,
      outputSchema: productImagesOutputSchema,
      annotations: {
        readOnlyHint: true,
      },
      _meta: {
        ui: {
          resourceUri: PRODUCT_IMAGES_WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": PRODUCT_IMAGES_WIDGET_URI,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Loading product images...",
        "openai/toolInvocation/invoked": "Product images ready",
      },
      handler: async (args: unknown) => {
        const detail = await client.getProductDetail(z.object(productDetailSchema).parse(args));
        const product = detail.product && typeof detail.product === "object" && !Array.isArray(detail.product)
          ? detail.product as Record<string, unknown>
          : {};

        return {
          ...detail,
          images: Array.isArray(product.images) ? product.images : [],
        };
      },
    },
    {
      name: "client_product_verify",
      title: "Verify storefront product for checkout",
      description:
        "Verify one storefront product by product id before purchase. Use this when the shopper expresses purchase intent and the model already has a product id from current conversation or prior tool results. Returns current availability, stock, price, and line total for the requested quantity.",
      inputSchema: productVerifySchema,
      outputSchema: productVerifyOutputSchema,
      handler: (args: unknown) =>
        client.verifyProduct(z.object(productVerifySchema).parse(args)),
    },
    {
      name: "client_order_list",
      title: "List customer orders",
      description:
        "List the signed-in customer's orders without requiring an order number. Use status=all for every recent order, status=pending for orders still being processed or shipped, and status=completed for delivered/completed orders. Results include payment and logistics progress when available.",
      inputSchema: orderListSchema,
      outputSchema: orderListOutputSchema,
      handler: (args: unknown) =>
        client.getOrderList(z.object(orderListSchema).parse(args)),
    },
    {
      name: "client_customer_context",
      title: "Get customer checkout context",
      description:
        "Retrieve the signed-in customer's profile and last order so the model can decide which buyer, recipient, phone, and address fields are still missing before preparing a checkout confirmation table.",
      inputSchema: customerContextSchema,
      outputSchema: customerContextOutputSchema,
      handler: () => client.getCustomerContext(),
    },
    {
      name: "client_order_preview",
      title: "Prepare checkout confirmation table",
      description:
        "Prepare a checkout confirmation table after product availability and required customer fields are known. This does not create an order or payment link. The table includes product id, product name, quantity, item totals, shipping fee, final total, buyer name/phone, recipient name/phone, and address. Do not include payment method or pickup/shipping method.",
      inputSchema: orderPreviewSchema,
      outputSchema: orderPreviewOutputSchema,
      _meta: {
        ui: {
          resourceUri: PRODUCT_LIST_WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": PRODUCT_LIST_WIDGET_URI,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Preparing confirmation...",
        "openai/toolInvocation/invoked": "Confirmation ready",
      },
      handler: (args: unknown) =>
        client.getOrderPreview(z.object(orderPreviewSchema).parse(args)),
    },
    {
      name: "client_checkout_start",
      title: "Start customer checkout session",
      description:
        "Create a short-lived checkout session draft after products, quantity, recipient, payment method, and logistics method are known. This may return an action_url for external store selection or payment; it does not itself complete provider callbacks. For pickup payment with reusable previous store data, ask for explicit shopper confirmation before using this tool to create or prepare a direct order flow.",
      inputSchema: checkoutStartSchema,
      outputSchema: checkoutOutputSchema,
      handler: (args: unknown) =>
        client.startCheckout(z.object(checkoutStartSchema).parse(args)),
    },
    {
      name: "client_checkout_status",
      title: "Get customer checkout session status",
      description:
        "Fetch a checkout session by checkoutToken after the shopper follows an action_url or says they completed store selection/payment. Use this instead of background polling.",
      inputSchema: checkoutStatusSchema,
      outputSchema: checkoutOutputSchema,
      handler: (args: unknown) =>
        client.getCheckoutStatus(z.object(checkoutStatusSchema).parse(args)),
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

function productDetailForModel(detail: WeblessJson): WeblessJson {
  const product = detail.product;
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    return detail;
  }

  const { images, ...productWithoutImages } = product as Record<string, unknown>;
  const imageCount = Array.isArray(images) ? images.length : 0;

  return {
    ...detail,
    product: {
      ...productWithoutImages,
      image_count: imageCount,
      has_image_gallery: imageCount > 0,
    },
  };
}

function toolResultText(name: string, result: WeblessJson): string {
  if (name === "client_product_images") {
    const images = Array.isArray(result.images) ? result.images : [];
    return `Product image gallery is available in the SlimWeb widget. ${images.length} images were returned.`;
  }

  if (name === "client_product_cards") {
    const items = Array.isArray(result.items) ? result.items : [];
    if (items.length === 0) {
      return "No selected storefront products were available for product cards.";
    }

    return `${items.length} selected storefront product cards are available in the SlimWeb widget.`;
  }

  if (name === "client_order_preview") {
    return "Checkout confirmation table is available in the SlimWeb widget. No order has been created.";
  }

  if (name === "client_checkout_start") {
    return "Checkout session has been prepared. Follow any action_url in the result if external store selection or payment is required.";
  }

  if (name === "client_checkout_status") {
    return "Checkout status is available in the tool result.";
  }

  if (name !== "client_catalog_search") {
    return JSON.stringify(result, null, 2);
  }

  const items = Array.isArray(result.items) ? result.items : [];
  if (items.length === 0) {
    return "No matching storefront products were found.";
  }

  return `Found ${items.length} storefront product candidates. Review these candidates, choose the final recommendation count requested by the shopper, then call client_product_cards with only the selected productIds.`;
}
