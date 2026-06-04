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
    ...overrides,
  };
}

test("tool registry exposes only consumer-facing tools", () => {
  const registry = createToolRegistry(fakeClient());

  assert.deepEqual(
    registry.listTools().map((tool) => tool.name),
    [
      "client_catalog_overview",
      "client_catalog_search",
      "client_product_detail",
      "client_product_verify",
      "client_order_list",
      "client_customer_context",
      "client_order_preview",
    ],
  );
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

test("unknown tools are rejected", async () => {
  const registry = createToolRegistry(fakeClient());

  await assert.rejects(
    () => registry.callTool("admin_refund_complete", {}),
    /Unknown tool: admin_refund_complete/,
  );
});
