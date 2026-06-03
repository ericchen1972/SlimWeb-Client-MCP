import assert from "node:assert/strict";
import test from "node:test";

import { WeblessClient } from "../src/webless-client.js";

test("getCatalogOverview sends site key to the storefront overview endpoint", async () => {
  const requests: Request[] = [];
  const client = new WeblessClient({
    baseUrl: "https://example.test",
    siteKey: "site-1",
    fetchImpl: async (input) => {
      requests.push(input as Request);
      return Response.json({ categories: [{ name: "機械錶" }] });
    },
  });

  const result = await client.getCatalogOverview();

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://example.test/api/storefront/catalog/overview?site=site-1",
  );
  assert.deepEqual(result, { categories: [{ name: "機械錶" }] });
});

test("searchCatalog sends query and site key to the storefront search endpoint", async () => {
  const requests: Request[] = [];
  const client = new WeblessClient({
    baseUrl: "https://example.test",
    siteKey: "site-1",
    fetchImpl: async (input) => {
      requests.push(input as Request);
      return Response.json({ items: [{ id: "p1", name: "Tea" }] });
    },
  });

  const result = await client.searchCatalog({ query: "tea", limit: 5 });

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://example.test/api/storefront/catalog/search?q=tea&limit=5&site=site-1",
  );
  assert.deepEqual(result, { items: [{ id: "p1", name: "Tea" }] });
});

test("searchCatalog sends optional price and recommendation fields", async () => {
  const requests: Request[] = [];
  const client = new WeblessClient({
    baseUrl: "https://example.test",
    siteKey: "site-1",
    fetchImpl: async (input) => {
      requests.push(input as Request);
      return Response.json({ items: [] });
    },
  });

  await client.searchCatalog({
    query: "watch",
    limit: 3,
    minPrice: 40000,
    maxPrice: 50000,
    popularity: "popular",
    priceOrder: "asc",
  });

  assert.equal(
    requests[0].url,
    "https://example.test/api/storefront/catalog/search?q=watch&limit=3&min_price=40000&max_price=50000&popularity=popular&price_order=asc&site=site-1",
  );
});

test("getOrderSummary sends order token as a path segment", async () => {
  const requests: Request[] = [];
  const client = new WeblessClient({
    baseUrl: "https://example.test",
    fetchImpl: async (input) => {
      requests.push(input as Request);
      return Response.json({ order: { number: "A001" } });
    },
  });

  const result = await client.getOrderSummary({ orderToken: "tok/123" });

  assert.equal(
    requests[0].url,
    "https://example.test/api/storefront/orders/tok%2F123",
  );
  assert.deepEqual(result, { order: { number: "A001" } });
});

test("requests throw a structured error for non-2xx Webless responses", async () => {
  const client = new WeblessClient({
    baseUrl: "https://example.test",
    fetchImpl: async () =>
      new Response(JSON.stringify({ message: "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(
    () => client.getProductDetail({ productId: "missing" }),
    /Webless request failed: 404 Not found/,
  );
});
