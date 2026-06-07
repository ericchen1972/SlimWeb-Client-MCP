import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import test from "node:test";

import { createRequestHandler } from "../src/app.js";
import { createSignedToken, verifySignedToken } from "../src/session.js";
import type {
  GoogleProfile,
  SiteMemberRepository,
} from "../src/site-member-repository.js";

const site = {
  id: 7,
  callbackCode: "swcb_zog0l7zlyp3lwmlc",
  name: "Demo Shop",
};

const member = {
  id: 11,
  siteId: site.id,
  email: "buyer@example.test",
  name: "Buyer",
  googleId: "google-sub-1",
};

test("Google login provisions a site member for the callback-code route", async () => {
  const provisions: Array<{ siteId: number; profile: GoogleProfile }> = [];
  const repository = fakeRepository({
    provisionMember: async (siteId, profile) => {
      provisions.push({ siteId, profile });
      return member;
    },
  });

  await withApp(repository, async (baseUrl, sessionSecret) => {
    const response = await fetch(`${baseUrl}/sites/${site.callbackCode}/auth/google`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: "google-id-token" }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.site.callback_code, site.callbackCode);
    assert.equal(body.member.id, member.id);
    assert.equal(body.session.token_type, "Bearer");
    assert.equal(typeof body.session.access_token, "string");
    assert.deepEqual(provisions, [
      {
        siteId: site.id,
        profile: {
          sub: "google-sub-1",
          email: "buyer@example.test",
          name: "Buyer",
          picture: "",
        },
      },
    ]);
  });
});

test("site MCP tools/list is routed by callback code", async () => {
  await withApp(fakeRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
      body.result.tools.map((tool: { name: string }) => tool.name),
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
    const searchTool = body.result.tools.find((tool: { name: string }) => tool.name === "client_catalog_search");
    assert.equal(searchTool.inputSchema.properties.limit.maximum, 5);
    assert.equal(searchTool.inputSchema.properties.minPrice.type, "number");
    assert.equal(searchTool.inputSchema.properties.freshness.enum[0], "latest");
    assert.equal(searchTool._meta, undefined);
    assert.equal(searchTool.outputSchema.properties.items.maxItems, 5);

    const cardsTool = body.result.tools.find((tool: { name: string }) => tool.name === "client_product_cards");
    assert.equal(cardsTool.inputSchema.properties.productIds.items.type, "string");
    assert.equal(cardsTool.inputSchema.required.includes("productIds"), true);
    assert.equal(cardsTool._meta.ui.resourceUri, "ui://widget/product-list.html");
    assert.equal(cardsTool._meta["openai/outputTemplate"], "ui://widget/product-list.html");
    assert.equal(cardsTool.outputSchema.properties.items.maxItems, 5);

    const authTool = body.result.tools.find((tool: { name: string }) => tool.name === "client_auth_status");
    assert.equal(authTool.outputSchema.properties.authenticated.type, "boolean");
    assert.equal(authTool.outputSchema.properties.customer.type, "object");

    const overviewTool = body.result.tools.find((tool: { name: string }) => tool.name === "client_catalog_overview");
    assert.equal(overviewTool.outputSchema.properties.categories.type, "array");

    const detailTool = body.result.tools.find((tool: { name: string }) => tool.name === "client_product_detail");
    assert.equal(detailTool._meta.ui.resourceUri, "ui://widget/product-list.html");
    assert.equal(detailTool._meta["openai/outputTemplate"], "ui://widget/product-list.html");
    assert.equal(detailTool.outputSchema.properties.product.type, "object");
    assert.equal(detailTool.outputSchema.properties.product.properties.image_count.type, "number");
    assert.equal(detailTool.outputSchema.properties.product.properties.has_image_gallery.type, "boolean");
    assert.equal(detailTool.outputSchema.properties.product.properties.images, undefined);

    const imageTool = body.result.tools.find((tool: { name: string }) => tool.name === "client_product_images");
    assert.equal(imageTool._meta.ui.resourceUri, "ui://widget/product-images.html");
    assert.equal(imageTool._meta["openai/outputTemplate"], "ui://widget/product-images.html");
    assert.equal(imageTool.outputSchema.properties.images.type, "array");

    const verifyTool = body.result.tools.find((tool: { name: string }) => tool.name === "client_product_verify");
    assert.equal(verifyTool.inputSchema.properties.productId.type, "string");
    assert.equal(verifyTool.outputSchema.properties.available.type, "boolean");

    const orderListTool = body.result.tools.find((tool: { name: string }) => tool.name === "client_order_list");
    assert.equal(orderListTool.inputSchema.properties.status.enum[0], "all");
    assert.equal(orderListTool.outputSchema.properties.orders.type, "array");

    const contextTool = body.result.tools.find((tool: { name: string }) => tool.name === "client_customer_context");
    assert.equal(contextTool.outputSchema.properties.customer.type, "object");

    const previewTool = body.result.tools.find((tool: { name: string }) => tool.name === "client_order_preview");
    assert.equal(previewTool.inputSchema.required.includes("recipientAddress"), true);
    assert.equal(previewTool._meta.ui.resourceUri, "ui://widget/product-list.html");
    assert.equal(previewTool.outputSchema.properties.preview.type, "object");

    const checkoutStartTool = body.result.tools.find((tool: { name: string }) => tool.name === "client_checkout_start");
    assert.equal(checkoutStartTool.inputSchema.required.includes("paymentMethod"), true);
    assert.equal(checkoutStartTool.outputSchema.properties.checkout.type, "object");

    const checkoutStatusTool = body.result.tools.find((tool: { name: string }) => tool.name === "client_checkout_status");
    assert.equal(checkoutStatusTool.inputSchema.required.includes("checkoutToken"), true);
    assert.equal(checkoutStatusTool.outputSchema.properties.checkout.type, "object");
  });
});

test("site MCP initialize works without OAuth like the admin MCP", async () => {
  await withApp(fakeRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.result.protocolVersion, "2025-03-26");
    assert.equal(body.result.serverInfo.name, "slimweb-client-mcp");
  });
});

test("site MCP product list widget resource can be listed and read", async () => {
  await withApp(fakeRepository(), async (baseUrl) => {
    const listResponse = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "resources/list",
      }),
    });
    const listBody = await listResponse.json();

    assert.equal(listResponse.status, 200);
    assert.equal(listBody.result.resources[0].uri, "ui://widget/product-list.html");
    assert.equal(listBody.result.resources[1].uri, "ui://widget/product-images.html");
    assert.equal(listBody.result.resources[0].mimeType, "text/html;profile=mcp-app");

    const readResponse = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "resources/read",
        params: {
          uri: "ui://widget/product-list.html",
        },
      }),
    });
    const readBody = await readResponse.json();

    assert.equal(readResponse.status, 200);
    assert.equal(readBody.result.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.match(readBody.result.contents[0].text, /slimweb-products/);
    assert.match(readBody.result.contents[0].text, /openai:set_globals/);
    assert.match(readBody.result.contents[0].text, /toolResponseMetadata/);
    assert.match(readBody.result.contents[0].text, /candidate\.product/);
    assert.match(readBody.result.contents[0].text, /callTool\("client_catalog_search"/);
    assert.match(readBody.result.contents[0].text, /Bridge diagnostics/);
    assert.match(readBody.result.contents[0].text, /toolOutput/);
    assert.match(readBody.result.contents[0].text, /toolOutputKeys/);
    assert.match(readBody.result.contents[0].text, /enqueueObjectValues/);
    assert.match(readBody.result.contents[0].text, /proxyImageUrl/);
    assert.match(readBody.result.contents[0].text, /lastEvents/);
    assert.match(readBody.result.contents[0].text, /Waiting for product data/);
    assert.equal(
      readBody.result.contents[0]._meta.ui.domain,
      "https://slimweb-client-mcp-aakwcbp2ca-de.a.run.app",
    );
    assert.equal(
      readBody.result.contents[0]._meta["openai/widgetDomain"],
      "https://slimweb-client-mcp-aakwcbp2ca-de.a.run.app",
    );
    assert.deepEqual(
      readBody.result.contents[0]._meta.ui.csp.resourceDomains,
      ["https://slimweb-client-mcp-aakwcbp2ca-de.a.run.app"],
    );

    const imageReadResponse = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 31,
        method: "resources/read",
        params: {
          uri: "ui://widget/product-images.html",
        },
      }),
    });
    const imageReadBody = await imageReadResponse.json();

    assert.equal(imageReadResponse.status, 200);
    assert.match(imageReadBody.result.contents[0].text, /slimweb-gallery/);
    assert.match(imageReadBody.result.contents[0].text, /proxyImageUrl/);
    assert.match(imageReadBody.result.contents[0].text, /Waiting for product image data/);
    assert.deepEqual(
      imageReadBody.result.contents[0]._meta.ui.csp.resourceDomains,
      ["https://slimweb-client-mcp-aakwcbp2ca-de.a.run.app"],
    );
  });
});

test("image proxy streams public image responses for widget CSP", async () => {
  const upstreamRequests: Request[] = [];

  await withApp(
    fakeRepository(),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/image-proxy?url=${encodeURIComponent("https://cdn.example.test/watch.png")}`);
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.equal(response.headers.get("cache-control"), "public, max-age=86400");
      assert.equal(body, "image-bytes");
      assert.equal(upstreamRequests.length, 1);
      assert.equal(upstreamRequests[0].url, "https://cdn.example.test/watch.png");
    },
    async (input) => {
      upstreamRequests.push(input as Request);
      return new Response("image-bytes", {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    },
  );
});

test("image proxy rejects private loopback targets", async () => {
  await withApp(fakeRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/image-proxy?url=${encodeURIComponent("http://127.0.0.1/private.png")}`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
  });
});

test("image proxy rejects redirects to private targets", async () => {
  await withApp(
    fakeRepository(),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/image-proxy?url=${encodeURIComponent("https://cdn.example.test/redirect.png")}`);
      const body = await response.json();

      assert.equal(response.status, 502);
      assert.equal(body.ok, false);
    },
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private.png" },
      }),
  );
});

test("site MCP storefront catalog overview can be called without a session", async () => {
  await withApp(fakeRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "client_catalog_overview",
          arguments: {},
        },
      }),
    });
    const body = await response.json();


    assert.equal(response.status, 200);
    assert.equal(body.result.content[0].type, "text");
  }, async () => Response.json({ categories: [{ name: "機械錶" }] }));
});

test("site MCP storefront catalog search can be called without a session", async () => {
  await withApp(fakeRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "client_catalog_search",
          arguments: { query: "tea" },
        },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.result.content[0].type, "text");
    assert.deepEqual(body.result.structuredContent, { items: [] });
    assert.match(body.result.content[0].text, /No matching storefront products/);
  });
});

test("site MCP tool argument validation errors return JSON-RPC errors without HTTP 500", async () => {
  await withApp(fakeRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "client_product_images",
          arguments: {},
        },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.error.code, -32602);
    assert.equal(body.error.data.reason, "INVALID_TOOL_ARGUMENTS");
    assert.match(body.error.message, /Invalid arguments for client_product_images/);
  });
});

test("site MCP customer context requires a session scoped to the same callback code", async () => {
  await withApp(fakeRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "client_customer_context",
          arguments: {},
        },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error.code, -32001);
    assert.equal(body.error.data.reason, "AUTH_REQUIRED");
    assert.equal(
      body.error.data.resource_metadata,
      `${baseUrl}/.well-known/oauth-protected-resource/sites/${site.callbackCode}/mcp`,
    );
    assert.match(
      response.headers.get("www-authenticate") ?? "",
      /oauth-protected-resource/,
    );
  });
});

test("site MCP order list requires a signed-in member session", async () => {
  await withApp(fakeRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "client_order_list",
          arguments: { status: "pending" },
        },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error.code, -32001);
  });
});

test("site MCP tools/call accepts a bearer session for the same callback code", async () => {
  await withApp(fakeRepository(), async (baseUrl, sessionSecret) => {
    const token = createSignedToken(
      {
        site_id: site.id,
        callback_code: site.callbackCode,
        member_id: member.id,
        email: member.email,
        google_id: member.googleId,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      sessionSecret,
    );

    const response = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "client_catalog_search",
          arguments: { query: "tea" },
        },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.result.content[0].type, "text");
    assert.deepEqual(body.result.structuredContent, { items: [] });
    assert.match(body.result.content[0].text, /No matching storefront products/);
  });
});

test("site MCP order preview passes the authenticated member id and payload to Webless", async () => {
  const weblessRequests: string[] = [];
  const weblessBodies: unknown[] = [];

  await withApp(
    fakeRepository(),
    async (baseUrl, sessionSecret) => {
      const token = createSignedToken(
        {
          site_id: site.id,
          callback_code: site.callbackCode,
          member_id: member.id,
          email: member.email,
          google_id: member.googleId,
          exp: Math.floor(Date.now() / 1000) + 60,
        },
        sessionSecret,
      );

      const response = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "client_order_preview",
            arguments: {
              items: [{ productId: 123, quantity: 2 }],
              buyerName: "Buyer",
              buyerPhone: "0900000000",
              recipientName: "Receiver",
              recipientPhone: "0912345678",
              recipientAddress: "台北市",
            },
          },
        }),
      });

      assert.equal(response.status, 200);
    },
    async (input) => {
      const request = input as Request;
      weblessRequests.push(request.url);
      weblessBodies.push(JSON.parse(await request.text()));
      return Response.json({ preview: { status: "ready", items: [] } });
    },
  );

  assert.equal(
    weblessRequests[0],
    `https://webless.example.test/api/storefront/order-preview?site=${site.callbackCode}&member_id=${member.id}`,
  );
  assert.deepEqual(weblessBodies[0], {
    items: [{ product_id: 123, quantity: 2 }],
    buyer_name: "Buyer",
    buyer_phone: "0900000000",
    recipient_name: "Receiver",
    recipient_phone: "0912345678",
    recipient_address: "台北市",
  });
});

test("site MCP order preview returns structured Webless errors without HTTP 500", async () => {
  await withApp(
    fakeRepository(),
    async (baseUrl, sessionSecret) => {
      const token = createSignedToken(
        {
          site_id: site.id,
          callback_code: site.callbackCode,
          member_id: member.id,
          email: member.email,
          google_id: member.googleId,
          exp: Math.floor(Date.now() / 1000) + 60,
        },
        sessionSecret,
      );

      const response = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 40,
          method: "tools/call",
          params: {
            name: "client_order_preview",
            arguments: {
              items: [{ productId: 123, quantity: 2 }],
              buyerName: "Buyer",
              buyerPhone: "0900000000",
              recipientName: "Receiver",
              recipientPhone: "0912345678",
              recipientAddress: "台北市",
            },
          },
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.error.code, -32010);
      assert.equal(body.error.data.reason, "WEBLESS_REQUEST_FAILED");
      assert.equal(body.error.data.webless_status, 502);
      assert.deepEqual(body.error.data.webless_body, { message: "Bad gateway" });
    },
    async () =>
      new Response(JSON.stringify({ message: "Bad gateway" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
  );
});

test("OAuth metadata is exposed for ChatGPT remote MCP discovery", async () => {
  await withApp(fakeRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    const body = await response.json();
    const siteScopedResponse = await fetch(
      `${baseUrl}/.well-known/oauth-authorization-server/sites/${site.callbackCode}/mcp`,
    );
    const siteScopedBody = await siteScopedResponse.json();

    assert.equal(response.status, 200);
    assert.equal(body.issuer, baseUrl);
    assert.equal(body.authorization_endpoint, `${baseUrl}/oauth/authorize`);
    assert.equal(body.token_endpoint, `${baseUrl}/oauth/token`);
    assert.equal(body.registration_endpoint, `${baseUrl}/oauth/register`);
    assert.deepEqual(body.response_types_supported, ["code"]);
    assert.equal(siteScopedResponse.status, 200);
    assert.equal(
      siteScopedBody.resource,
      `${baseUrl}/sites/${site.callbackCode}/mcp`,
    );
  });
});

test("OAuth authorization code flow follows the admin MCP session broker pattern", async () => {
  const provisions: Array<{ siteId: number; profile: GoogleProfile }> = [];
  const repository = fakeRepository({
    provisionMember: async (siteId, profile) => {
      provisions.push({ siteId, profile });
      return member;
    },
  });

  await withApp(repository, async (baseUrl, sessionSecret) => {
    const codeVerifier = "abcdefghijklmnopqrstuvwxyz0123456789";
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const authorizeParams = {
      client_id: "chatgpt",
      redirect_uri: `${baseUrl}/oauth/callback`,
      response_type: "code",
      state: "state-1",
      resource: `${baseUrl}/sites/${site.callbackCode}/mcp`,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    };
    const authorizeUrl = `${baseUrl}/oauth/authorize?${new URLSearchParams(authorizeParams)}`;
    const firstAuthorizeResponse = await fetch(authorizeUrl, {
      redirect: "manual",
    });

    assert.equal(firstAuthorizeResponse.status, 302);
    assert.equal(
      firstAuthorizeResponse.headers.get("location"),
      `/auth/login?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(authorizeParams)}`)}`,
    );

    const loginResponse = await fetch(`${baseUrl}/auth/google`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        credential: "google-id-token",
        next: `/oauth/authorize?${new URLSearchParams(authorizeParams)}`,
      }),
    });
    const loginBody = await loginResponse.json();
    const sessionCookie = loginResponse.headers.get("set-cookie");

    assert.equal(loginResponse.status, 200);
    assert.equal(loginBody.ok, true);
    assert.equal(loginBody.next, `/oauth/authorize?${new URLSearchParams(authorizeParams)}`);
    assert(sessionCookie);

    const authorizeResponse = await fetch(authorizeUrl, {
      headers: { cookie: sessionCookie },
      redirect: "manual",
    });
    const redirectLocation = authorizeResponse.headers.get("location");

    assert.equal(authorizeResponse.status, 302);
    assert(redirectLocation);

    const redirected = new URL(redirectLocation);
    const code = redirected.searchParams.get("code");
    assert.equal(redirected.searchParams.get("state"), "state-1");
    assert(code);

    const codePayload = verifySignedToken(code, sessionSecret);
    assert.equal(codePayload?.typ, "oauth_code");
    assert.equal(codePayload?.email, member.email);
    assert.equal(codePayload?.member_id, member.id);
    assert.equal("access_token" in (codePayload ?? {}), false);

    const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: authorizeParams.redirect_uri,
        client_id: authorizeParams.client_id,
        code_verifier: codeVerifier,
      }),
    });
    const tokenBody = await tokenResponse.json();

    assert.equal(tokenResponse.status, 200);
    assert.equal(tokenBody.token_type, "Bearer");
    assert.equal(typeof tokenBody.access_token, "string");
    assert.deepEqual(provisions, [
      {
        siteId: site.id,
        profile: {
          sub: "google-sub-1",
          email: "buyer@example.test",
          name: "Buyer",
          picture: "",
        },
      },
    ]);

    const toolResponse = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenBody.access_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "client_catalog_search",
          arguments: { query: "tea" },
        },
      }),
    });
    const toolBody = await toolResponse.json();

    assert.equal(toolResponse.status, 200);
    assert.equal(toolBody.result.content[0].type, "text");
  });
});

async function withApp(
  repository: SiteMemberRepository,
  run: (baseUrl: string, sessionSecret: string) => Promise<void>,
  fetchImpl: typeof fetch = async () => Response.json({ items: [] }),
) {
  const sessionSecret = "test-secret";
  const handler = createRequestHandler({
    config: {
      baseUrl: "https://webless.example.test",
      sessionSecret,
    },
    googleVerifier: {
      verify: async () => ({
        sub: "google-sub-1",
        email: "buyer@example.test",
        name: "Buyer",
        picture: "",
      }),
    },
    repository,
    fetchImpl,
  });
  const server = createServer(handler);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const { port } = address as AddressInfo;
    await run(`http://127.0.0.1:${port}`, sessionSecret);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function fakeRepository(
  overrides: Partial<SiteMemberRepository> = {},
): SiteMemberRepository {
  return {
    findSiteByCallbackCode: async (callbackCode) =>
      callbackCode === site.callbackCode ? site : null,
    provisionMember: async () => member,
    ...overrides,
  };
}
