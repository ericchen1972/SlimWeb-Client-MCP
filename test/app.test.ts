import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import test from "node:test";

import { createRequestHandler } from "../src/app.js";
import { createSignedToken } from "../src/session.js";
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

  await withApp(repository, async (baseUrl) => {
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
        "client_catalog_overview",
        "client_catalog_search",
        "client_product_detail",
        "client_order_lookup",
      ],
    );
    const searchTool = body.result.tools.find((tool: { name: string }) => tool.name === "client_catalog_search");
    assert.equal(searchTool.inputSchema.properties.limit.maximum, 10);
    assert.equal(searchTool.inputSchema.properties.minPrice.type, "number");
    assert.equal(searchTool.inputSchema.properties.freshness.enum[0], "latest");
  });
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

test("site MCP storefront catalog tools can be called without a session", async () => {
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
    assert.match(body.result.content[0].text, /"items"/);
  });
});

test("site MCP order lookup requires a session scoped to the same callback code", async () => {
  await withApp(fakeRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sites/${site.callbackCode}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "client_order_lookup",
          arguments: { orderToken: "SW202606030001" },
        },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error.code, -32001);
    assert.match(
      response.headers.get("www-authenticate") ?? "",
      /oauth-protected-resource/,
    );
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
    assert.match(body.result.content[0].text, /"items"/);
  });
});

test("site MCP order lookup passes the authenticated member id to Webless", async () => {
  const weblessRequests: string[] = [];

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
            name: "client_order_lookup",
            arguments: { orderToken: "SW202606030001" },
          },
        }),
      });

      assert.equal(response.status, 200);
    },
    async (input) => {
      weblessRequests.push((input as Request).url);
      return Response.json({ order: { number: "SW202606030001" } });
    },
  );

  assert.equal(
    weblessRequests[0],
    `https://webless.example.test/api/storefront/orders/SW202606030001?site=${site.callbackCode}&member_id=${member.id}`,
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

test("OAuth authorization code flow issues a bearer token accepted by tools/call", async () => {
  const provisions: Array<{ siteId: number; profile: GoogleProfile }> = [];
  const repository = fakeRepository({
    provisionMember: async (siteId, profile) => {
      provisions.push({ siteId, profile });
      return member;
    },
  });

  await withApp(repository, async (baseUrl) => {
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
    const authorizeResponse = await fetch(`${baseUrl}/oauth/google`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...authorizeParams,
        credential: "google-id-token",
      }),
      redirect: "manual",
    });
    const redirectLocation = authorizeResponse.headers.get("location");

    assert.equal(authorizeResponse.status, 302);
    assert(redirectLocation);

    const redirected = new URL(redirectLocation);
    const code = redirected.searchParams.get("code");
    assert.equal(redirected.searchParams.get("state"), "state-1");
    assert(code);

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
