import assert from "node:assert/strict";
import test from "node:test";

import { createToolRegistry, type ConsumerWeblessClient } from "../src/tools.js";

function fakeClient(overrides: Partial<ConsumerWeblessClient> = {}): ConsumerWeblessClient {
  return {
    getCatalogOverview: async () => ({ categories: [] }),
    searchCatalog: async () => ({ items: [] }),
    getProductDetail: async () => ({ product: null }),
    verifyProduct: async () => ({ available: true }),
    getOrderList: async () => ({ orders: [] }),
    getCustomerContext: async () => ({ customer: {}, last_order: null }),
    getOrderPreview: async () => ({ preview: { items: [] } }),
    startCheckout: async () => ({ checkout: { token: "checkout-token" } }),
    getCheckoutStatus: async () => ({ checkout: { status: "draft" } }),
    ...overrides,
  };
}

test("tool registry exposes only consumer-facing tools", () => {
  const registry = createToolRegistry(fakeClient());

  assert.deepEqual(
    registry.listTools().map((tool) => tool.name),
    [
      "client_auth_status",
      "client_catalog_overview",
      "client_catalog_search",
      "client_product_cards",
      "client_product_detail",
      "client_product_images",
      "client_product_verify",
      "client_order_list",
      "client_customer_context",
      "client_order_preview",
      "client_checkout_start",
      "client_checkout_status",
    ],
  );
});

test("client_auth_status returns the authenticated customer status", async () => {
  const registry = createToolRegistry(fakeClient(), {
    authenticated: true,
    customer: {
      id: 11,
      email: "buyer@example.test",
      google_id: "google-sub-1",
    },
  });

  const result = await registry.callTool("client_auth_status", {});

  assert.deepEqual(result.structuredContent, {
    authenticated: true,
    customer: {
      id: 11,
      email: "buyer@example.test",
      google_id: "google-sub-1",
    },
  });
});

test("client_catalog_overview dispatches to Webless catalog overview", async () => {
  const registry = createToolRegistry(fakeClient({
    getCatalogOverview: async () => ({
      categories: [{ name: "機械錶", path: ["精品手錶", "機械錶"] }],
    }),
  }));

  const result = await registry.callTool("client_catalog_overview", {});

  assert.deepEqual(result, {
    structuredContent: {
      categories: [{ name: "機械錶", path: ["精品手錶", "機械錶"] }],
    },
    content: [
      {
        type: "text",
        text: JSON.stringify({
          categories: [{ name: "機械錶", path: ["精品手錶", "機械錶"] }],
        }, null, 2),
      },
    ],
  });
});

test("client_catalog_search dispatches to Webless catalog search", async () => {
  const registry = createToolRegistry(fakeClient({
    searchCatalog: async (input) => ({ received: input }),
  }));

  const result = await registry.callTool("client_catalog_search", {
    query: "tea",
    limit: 3,
    minPrice: 1000,
    maxPrice: 5000,
    freshness: "latest",
  });

  assert.deepEqual(result, {
    structuredContent: {
      received: {
        query: "tea",
        limit: 3,
        minPrice: 1000,
        maxPrice: 5000,
        freshness: "latest",
      },
    },
    content: [
      {
        type: "text",
        text: "No matching storefront products were found.",
      },
    ],
  });
});

test("client_product_cards renders only selected products after model choice", async () => {
  const requestedIds: string[] = [];
  const registry = createToolRegistry(fakeClient({
    getProductDetail: async (input) => {
      requestedIds.push(input.productId);

      return {
        site: { id: 1, name: "Demo Shop" },
        product: {
          id: Number(input.productId),
          name: `Product ${input.productId}`,
          image_url: `https://example.test/${input.productId}.webp`,
          images: [
            { url: `https://example.test/${input.productId}-detail.webp` },
          ],
          price: { amount: 1000 },
          regular_price: { amount: 1200 },
        },
      };
    },
  }));

  const result = await registry.callTool("client_product_cards", {
    productIds: ["380", "423"],
  });

  assert.deepEqual(requestedIds, ["380", "423"]);
  assert.deepEqual(result.structuredContent?.site, { id: 1, name: "Demo Shop" });
  assert.deepEqual(
    (result.structuredContent?.items as Array<Record<string, unknown>>).map((item) => item.id),
    [380, 423],
  );
  assert.equal(
    (result.structuredContent?.items as Array<Record<string, unknown>>)[0].images,
    undefined,
  );
  assert.match(result.content[0].text, /2 selected storefront product cards/);
});

test("client_catalog_search rejects more than five requested products", async () => {
  const registry = createToolRegistry(fakeClient());

  await assert.rejects(
    () => registry.callTool("client_catalog_search", {
      query: "tea",
      limit: 6,
    }),
    /Number must be less than or equal to 5/,
  );
});

test("client_product_images dispatches detail lookup and exposes gallery images", async () => {
  const registry = createToolRegistry(fakeClient({
    getProductDetail: async (input) => ({
      site: { id: 1 },
      product: {
        id: Number(input.productId),
        name: "Watch",
        images: [
          { url: "https://example.test/watch-1.webp", type: "primary" },
          { url: "https://example.test/watch-2.webp", type: "content" },
        ],
      },
    }),
  }));

  const result = await registry.callTool("client_product_images", {
    productId: "380",
  });

  assert.deepEqual(result.structuredContent?.images, [
    { url: "https://example.test/watch-1.webp", type: "primary" },
    { url: "https://example.test/watch-2.webp", type: "content" },
  ]);
  assert.match(result.content[0].text, /2 images/);
});

test("client_product_detail hides gallery images and exposes gallery availability", async () => {
  const registry = createToolRegistry(fakeClient({
    getProductDetail: async (input) => ({
      site: { id: 1 },
      product: {
        id: Number(input.productId),
        name: "Watch",
        image_url: "https://example.test/watch.webp",
        images: [
          { url: "https://example.test/watch-1.webp", type: "primary" },
          { url: "https://example.test/watch-2.webp", type: "content" },
        ],
      },
    }),
  }));

  const result = await registry.callTool("client_product_detail", {
    productId: "380",
  });

  assert.deepEqual(result.structuredContent, {
    site: { id: 1 },
    product: {
      id: 380,
      name: "Watch",
      image_url: "https://example.test/watch.webp",
      image_count: 2,
      has_image_gallery: true,
    },
  });
});

test("client_product_detail reports unavailable gallery when no extra images exist", async () => {
  const registry = createToolRegistry(fakeClient({
    getProductDetail: async (input) => ({
      site: { id: 1 },
      product: {
        id: Number(input.productId),
        name: "Watch",
        image_url: "https://example.test/watch.webp",
        images: [],
      },
    }),
  }));

  const result = await registry.callTool("client_product_detail", {
    productId: "380",
  });

  assert.deepEqual(result.structuredContent?.product, {
    id: 380,
    name: "Watch",
    image_url: "https://example.test/watch.webp",
    image_count: 0,
    has_image_gallery: false,
  });
});

test("client_product_verify dispatches product id and quantity to Webless", async () => {
  const registry = createToolRegistry(fakeClient({
    verifyProduct: async (input) => ({ received: input }),
  }));

  const result = await registry.callTool("client_product_verify", {
    productId: "123",
    quantity: 2,
  });

  assert.deepEqual(result.structuredContent, {
    received: {
      productId: "123",
      quantity: 2,
    },
  });
});

test("client_order_list dispatches status filters to Webless", async () => {
  const registry = createToolRegistry(fakeClient({
    getOrderList: async (input) => ({ received: input }),
  }));

  const result = await registry.callTool("client_order_list", {
    status: "pending",
    limit: 5,
  });

  assert.deepEqual(result.structuredContent, {
    received: {
      status: "pending",
      limit: 5,
    },
  });
});

test("client_customer_context dispatches without arguments", async () => {
  const registry = createToolRegistry(fakeClient({
    getCustomerContext: async () => ({ received: true }),
  }));

  const result = await registry.callTool("client_customer_context", {});

  assert.deepEqual(result.structuredContent, { received: true });
});

test("client_order_preview dispatches confirmation fields to Webless", async () => {
  const registry = createToolRegistry(fakeClient({
    getOrderPreview: async (input) => ({ received: input }),
  }));

  const result = await registry.callTool("client_order_preview", {
    items: [{ productId: 123, quantity: 2 }],
    buyerName: "Buyer",
    buyerPhone: "0900000000",
    recipientName: "Receiver",
    recipientPhone: "0912345678",
    recipientAddress: "台北市",
  });

  assert.deepEqual(result.structuredContent, {
    received: {
      items: [{ productId: 123, quantity: 2 }],
      buyerName: "Buyer",
      buyerPhone: "0900000000",
      recipientName: "Receiver",
      recipientPhone: "0912345678",
      recipientAddress: "台北市",
    },
  });
  assert.match(result.content[0].text, /No order has been created/);
});

test("client_checkout_start creates a checkout session draft", async () => {
  const registry = createToolRegistry(fakeClient({
    startCheckout: async (input) => ({ received: input }),
  }));

  const result = await registry.callTool("client_checkout_start", {
    items: [{ productId: 123, quantity: 2 }],
    buyerName: "Buyer",
    buyerPhone: "0900000000",
    recipientName: "Receiver",
    recipientPhone: "0912345678",
    recipientAddress: "台北市",
    paymentMethod: "pickup_pay",
    logisticsMethod: "cvs_pickup",
    reusePreviousStore: true,
    confirmBeforeCreate: true,
  });

  assert.deepEqual(result.structuredContent, {
    received: {
      items: [{ productId: 123, quantity: 2 }],
      buyerName: "Buyer",
      buyerPhone: "0900000000",
      recipientName: "Receiver",
      recipientPhone: "0912345678",
      recipientAddress: "台北市",
      paymentMethod: "pickup_pay",
      logisticsMethod: "cvs_pickup",
      reusePreviousStore: true,
      confirmBeforeCreate: true,
    },
  });
  assert.match(result.content[0].text, /Checkout session/);
});

test("client_checkout_status fetches checkout session state by token", async () => {
  const registry = createToolRegistry(fakeClient({
    getCheckoutStatus: async (input) => ({ received: input }),
  }));

  const result = await registry.callTool("client_checkout_status", {
    checkoutToken: "chk_123",
  });

  assert.deepEqual(result.structuredContent, {
    received: {
      checkoutToken: "chk_123",
    },
  });
  assert.match(result.content[0].text, /Checkout status/);
});

test("unknown tools are rejected", async () => {
  const registry = createToolRegistry(fakeClient());

  await assert.rejects(
    () => registry.callTool("admin_refund_complete", {}),
    /Unknown tool: admin_refund_complete/,
  );
});
