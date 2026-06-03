import assert from "node:assert/strict";
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
    assert.equal(body.result.tools[0].name, "client_catalog_search");
  });
});

test("site MCP tools/call requires a session scoped to the same callback code", async () => {
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

    assert.equal(response.status, 401);
    assert.equal(body.error.code, -32001);
    assert.match(body.error.message, /Google login required/);
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
