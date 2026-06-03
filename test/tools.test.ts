import assert from "node:assert/strict";
import test from "node:test";

import { createToolRegistry } from "../src/tools.js";

test("tool registry exposes only consumer-facing tools", () => {
  const registry = createToolRegistry({
    getCatalogOverview: async () => ({ categories: [] }),
    searchCatalog: async () => ({ items: [] }),
    getProductDetail: async () => ({ product: null }),
    getOrderList: async () => ({ orders: [] }),
    getOrderSummary: async () => ({ order: null }),
  });

  assert.deepEqual(
    registry.listTools().map((tool) => tool.name),
    [
      "client_catalog_overview",
      "client_catalog_search",
      "client_product_detail",
      "client_order_list",
      "client_order_lookup",
    ],
  );
});

test("client_catalog_overview dispatches to Webless catalog overview", async () => {
  const registry = createToolRegistry({
    getCatalogOverview: async () => ({
      categories: [{ name: "機械錶", path: ["精品手錶", "機械錶"] }],
    }),
    searchCatalog: async () => ({ items: [] }),
    getProductDetail: async () => ({ product: null }),
    getOrderList: async () => ({ orders: [] }),
    getOrderSummary: async () => ({ order: null }),
  });

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
  const registry = createToolRegistry({
    getCatalogOverview: async () => ({ categories: [] }),
    searchCatalog: async (input) => ({ received: input }),
    getProductDetail: async () => ({ product: null }),
    getOrderList: async () => ({ orders: [] }),
    getOrderSummary: async () => ({ order: null }),
  });

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
  const registry = createToolRegistry({
    getCatalogOverview: async () => ({ categories: [] }),
    searchCatalog: async (input) => ({ received: input }),
    getProductDetail: async () => ({ product: null }),
    getOrderList: async () => ({ orders: [] }),
    getOrderSummary: async () => ({ order: null }),
  });

  await assert.rejects(
    () => registry.callTool("client_catalog_search", {
      query: "tea",
      limit: 6,
    }),
    /Number must be less than or equal to 5/,
  );
});

test("client_order_list dispatches status filters to Webless", async () => {
  const registry = createToolRegistry({
    getCatalogOverview: async () => ({ categories: [] }),
    searchCatalog: async () => ({ items: [] }),
    getProductDetail: async () => ({ product: null }),
    getOrderList: async (input) => ({ received: input }),
    getOrderSummary: async () => ({ order: null }),
  });

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

test("unknown tools are rejected", async () => {
  const registry = createToolRegistry({
    getCatalogOverview: async () => ({ categories: [] }),
    searchCatalog: async () => ({ items: [] }),
    getProductDetail: async () => ({ product: null }),
    getOrderList: async () => ({ orders: [] }),
    getOrderSummary: async () => ({ order: null }),
  });

  await assert.rejects(
    () => registry.callTool("admin_refund_complete", {}),
    /Unknown tool: admin_refund_complete/,
  );
});
