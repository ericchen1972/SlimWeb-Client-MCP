import type { IncomingMessage, ServerResponse } from "node:http";

import type { ClientMcpConfig } from "./config.js";
import {
  GoogleIdentityVerifier,
  type GoogleVerifier,
} from "./google-verifier.js";
import {
  createSessionToken,
  readSessionToken,
  sessionCookie,
  type ClientSessionPayload,
  verifySessionToken,
} from "./session.js";
import {
  PostgresSiteMemberRepository,
  type ClientSite,
  type SiteMemberRepository,
} from "./site-member-repository.js";
import { createToolRegistry } from "./tools.js";
import { WeblessClient } from "./webless-client.js";

interface RequestHandlerOptions {
  config: ClientMcpConfig;
  googleVerifier?: GoogleVerifier;
  repository?: SiteMemberRepository;
  fetchImpl?: typeof fetch;
}

export function createRequestHandler(options: RequestHandlerOptions) {
  const sessionSecret = options.config.sessionSecret ?? "";
  const verifier =
    options.googleVerifier ??
    new GoogleIdentityVerifier({
      clientId: options.config.googleClientId,
      fetchImpl: options.fetchImpl,
    });
  const repository = options.repository ?? new PostgresSiteMemberRepository();

  return async function requestHandler(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");

    try {
      if (request.method === "GET" && ["/", "/healthz", "/readyz"].includes(url.pathname)) {
        jsonResponse(response, 200, {
          ok: true,
          service: "slimweb-client-mcp",
          status: "ready",
        });
        return;
      }

      const siteRoute = matchSiteRoute(url.pathname);

      if (!siteRoute) {
        jsonResponse(response, 404, { ok: false, error: "Not found" });
        return;
      }

      const site = await repository.findSiteByCallbackCode(siteRoute.callbackCode);

      if (!site) {
        jsonResponse(response, 404, {
          ok: false,
          error: "Unknown SlimWeb site MCP code.",
        });
        return;
      }

      if (siteRoute.action === "auth/google") {
        await handleGoogleLogin(request, response, site, verifier, repository, sessionSecret);
        return;
      }

      if (siteRoute.action === "mcp") {
        await handleMcp(request, response, site, options, sessionSecret);
        return;
      }

      jsonResponse(response, 404, { ok: false, error: "Not found" });
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

async function handleGoogleLogin(
  request: IncomingMessage,
  response: ServerResponse,
  site: ClientSite,
  verifier: GoogleVerifier,
  repository: SiteMemberRepository,
  sessionSecret: string,
): Promise<void> {
  if (request.method !== "POST") {
    methodNotAllowed(response);
    return;
  }

  const body = await readJsonRequest(request);
  const credential =
    body && typeof body === "object" && "credential" in body
      ? String(body.credential)
      : "";
  const profile = await verifier.verify(credential);
  const member = await repository.provisionMember(site.id, profile);
  const token = createSessionToken(
    {
      site_id: site.id,
      callback_code: site.callbackCode,
      member_id: member.id,
      email: member.email,
      google_id: member.googleId,
    },
    sessionSecret,
  );

  jsonResponse(
    response,
    200,
    {
      ok: true,
      site: {
        id: site.id,
        callback_code: site.callbackCode,
        name: site.name,
      },
      member: {
        id: member.id,
        email: member.email,
        name: member.name,
      },
      session: {
        token_type: "Bearer",
        access_token: token,
      },
    },
    {
      "set-cookie": sessionCookie(token, process.env.NODE_ENV === "production"),
    },
  );
}

async function handleMcp(
  request: IncomingMessage,
  response: ServerResponse,
  site: ClientSite,
  options: RequestHandlerOptions,
  sessionSecret: string,
): Promise<void> {
  if (request.method !== "POST") {
    methodNotAllowed(response);
    return;
  }

  const message = await readJsonRequest(request);

  if (!message || typeof message !== "object") {
    jsonResponse(response, 200, mcpError(null, -32700, "Invalid JSON request body"));
    return;
  }

  let session: ClientSessionPayload | null = null;

  if (message.method === "tools/call") {
    session = verifySessionToken(
      readSessionToken({
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
      }),
      sessionSecret,
    );

    if (!session || session.callback_code !== site.callbackCode || session.site_id !== site.id) {
      jsonResponse(response, 401, mcpError(message.id ?? null, -32001, "Google login required for this site MCP."));
      return;
    }
  }

  jsonResponse(response, 200, await handleMcpMessage(message, site, options, session));
}

async function handleMcpMessage(
  message: Record<string, unknown>,
  site: ClientSite,
  options: RequestHandlerOptions,
  session: ClientSessionPayload | null = null,
) {
  const id = message.id ?? null;

  switch (message.method) {
    case "initialize":
      return mcpResult(id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "slimweb-client-mcp", version: "0.1.0" },
      });

    case "tools/list": {
      const registry = createSiteRegistry(site, options);
      return mcpResult(id, { tools: registry.listTools().map(toolForMcp) });
    }

    case "tools/call": {
      const params =
        message.params && typeof message.params === "object"
          ? (message.params as Record<string, unknown>)
          : {};
      const registry = createSiteRegistry(site, options, session);
      const result = await registry.callTool(
        String(params.name ?? ""),
        params.arguments ?? {},
      );

      return mcpResult(id, result);
    }

    default:
      return mcpError(id, -32601, `Unknown MCP method: ${String(message.method)}`);
  }
}

function createSiteRegistry(
  site: ClientSite,
  options: RequestHandlerOptions,
  session: ClientSessionPayload | null = null,
) {
  return createToolRegistry(
    new WeblessClient({
      baseUrl: options.config.baseUrl,
      siteKey: site.callbackCode,
      memberId: session?.member_id,
      fetchImpl: options.fetchImpl,
    }),
  );
}

function toolForMcp(tool: ReturnType<ReturnType<typeof createToolRegistry>["listTools"]>[number]) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        Object.keys(tool.inputSchema).map((key) => [key, {}]),
      ),
    },
  };
}

function matchSiteRoute(pathname: string):
  | { callbackCode: string; action: "mcp" | "auth/google" }
  | null {
  const match = pathname.match(/^\/sites\/([^/]+)\/(mcp|auth\/google)$/);

  if (!match) {
    return null;
  }

  return {
    callbackCode: decodeURIComponent(match[1]),
    action: match[2] as "mcp" | "auth/google",
  };
}

async function readJsonRequest(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return null;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function jsonResponse(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function methodNotAllowed(response: ServerResponse): void {
  jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
}

function mcpResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function mcpError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
