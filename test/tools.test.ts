import assert from "node:assert/strict";
import test from "node:test";

import { createToolRegistry } from "../src/tools.js";

test("tool registry exposes only consumer-facing tools", () => {
  const registry = createToolRegistry({
    searchCatalog: async () => ({ items: [] }),
    getProductDetail: async () => ({ product: null }),
    getOrderSummary: async () => ({ order: null }),
  });

  assert.deepEqual(
    registry.listTools().map((tool) => tool.name),
    ["client_catalog_search", "client_product_detail", "client_order_lookup"],
  );
});

test("client_catalog_search dispatches to Webless catalog search", async () => {
  const registry = createToolRegistry({
    searchCatalog: async (input) => ({ received: input }),
    getProductDetail: async () => ({ product: null }),
    getOrderSummary: async () => ({ order: null }),
  });

  const result = await registry.callTool("client_catalog_search", {
    query: "tea",
    limit: 3,
  });

  assert.deepEqual(result, {
    content: [
      {
        type: "text",
        text: JSON.stringify({ received: { query: "tea", limit: 3 } }, null, 2),
      },
    ],
  });
});

test("unknown tools are rejected", async () => {
  const registry = createToolRegistry({
    searchCatalog: async () => ({ items: [] }),
    getProductDetail: async () => ({ product: null }),
    getOrderSummary: async () => ({ order: null }),
  });

  await assert.rejects(
    () => registry.callTool("admin_refund_complete", {}),
    /Unknown tool: admin_refund_complete/,
  );
});
