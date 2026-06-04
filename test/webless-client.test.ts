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

test("verifyProduct sends product id and quantity to the verify endpoint", async () => {
  const requests: Request[] = [];
  const client = new WeblessClient({
    baseUrl: "https://example.test",
    siteKey: "site-1",
    fetchImpl: async (input) => {
      requests.push(input as Request);
      return Response.json({ available: true });
    },
  });

  const result = await client.verifyProduct({ productId: "123", quantity: 2 });

  assert.equal(
    requests[0].url,
    "https://example.test/api/storefront/products/123/verify?site=site-1&quantity=2",
  );
  assert.deepEqual(result, { available: true });
});

test("getOrderList sends member id and status filters", async () => {
  const requests: Request[] = [];
  const client = new WeblessClient({
    baseUrl: "https://example.test",
    siteKey: "site-1",
    memberId: 42,
    fetchImpl: async (input) => {
      requests.push(input as Request);
      return Response.json({ orders: [{ number: "A001" }] });
    },
  });

  const result = await client.getOrderList({ status: "pending", limit: 5 });

  assert.equal(
    requests[0].url,
    "https://example.test/api/storefront/orders?site=site-1&member_id=42&status=pending&limit=5",
  );
  assert.deepEqual(result, { orders: [{ number: "A001" }] });
});

test("getCustomerContext sends member id to the storefront customer endpoint", async () => {
  const requests: Request[] = [];
  const client = new WeblessClient({
    baseUrl: "https://example.test",
    siteKey: "site-1",
    memberId: 42,
    fetchImpl: async (input) => {
      requests.push(input as Request);
      return Response.json({ customer: { name: "Buyer" } });
    },
  });

  const result = await client.getCustomerContext();

  assert.equal(
    requests[0].url,
    "https://example.test/api/storefront/customer/context?site=site-1&member_id=42",
  );
  assert.deepEqual(result, { customer: { name: "Buyer" } });
});

test("getOrderPreview posts confirmation fields to the storefront preview endpoint", async () => {
  const requests: Request[] = [];
  const bodies: unknown[] = [];
  const client = new WeblessClient({
    baseUrl: "https://example.test",
    siteKey: "site-1",
    memberId: 42,
    fetchImpl: async (input) => {
      const request = input as Request;
      requests.push(request);
      bodies.push(JSON.parse(await request.text()));
      return Response.json({ preview: { status: "ready" } });
    },
  });

  const result = await client.getOrderPreview({
    items: [{ productId: 123, quantity: 2 }],
    buyerName: "Buyer",
    buyerPhone: "0900000000",
    recipientName: "Receiver",
    recipientPhone: "0912345678",
    recipientAddress: "台北市",
  });

  assert.equal(
    requests[0].url,
    "https://example.test/api/storefront/order-preview?site=site-1&member_id=42",
  );
  assert.equal(requests[0].method, "POST");
  assert.deepEqual(bodies[0], {
    items: [{ product_id: 123, quantity: 2 }],
    buyer_name: "Buyer",
    buyer_phone: "0900000000",
    recipient_name: "Receiver",
    recipient_phone: "0912345678",
    recipient_address: "台北市",
  });
  assert.deepEqual(result, { preview: { status: "ready" } });
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
