import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";

import type { ClientMcpConfig } from "./config.js";
import {
  GoogleIdentityVerifier,
  type GoogleVerifier,
} from "./google-verifier.js";
import {
  createSessionToken,
  createSignedToken,
  readSessionToken,
  sessionCookie,
  type ClientSessionPayload,
  verifySessionToken,
  verifySignedToken,
} from "./session.js";
import {
  PostgresSiteMemberRepository,
  type ClientSite,
  type SiteMemberRepository,
} from "./site-member-repository.js";
import { createToolRegistry } from "./tools.js";
import { WeblessClient, WeblessRequestError } from "./webless-client.js";
import {
  productImagesWidgetContents,
  productImagesWidgetResource,
  PRODUCT_IMAGES_WIDGET_URI,
  productListWidgetContents,
  productListWidgetResource,
  PRODUCT_LIST_WIDGET_URI,
} from "./widgets.js";

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

      if (url.pathname === "/image-proxy") {
        await handleImageProxy(request, response, url, options.fetchImpl ?? fetch);
        return;
      }

      if (isOAuthMetadataPath(url.pathname)) {
        handleOAuthMetadata(request, response, options);
        return;
      }

      if (url.pathname === "/oauth/register") {
        await handleOAuthRegister(request, response);
        return;
      }

      if (url.pathname === "/auth/login") {
        handleAuthLogin(request, response, options);
        return;
      }

      if (url.pathname === "/auth/google") {
        await handleAuthGoogle(
          request,
          response,
          options,
          verifier,
          repository,
          sessionSecret,
        );
        return;
      }

      if (url.pathname === "/oauth/authorize") {
        await handleOAuthAuthorize(request, response, options, sessionSecret);
        return;
      }

      if (url.pathname === "/oauth/google") {
        await handleAuthGoogle(
          request,
          response,
          options,
          verifier,
          repository,
          sessionSecret,
        );
        return;
      }

      if (url.pathname === "/oauth/token") {
        await handleOAuthToken(request, response, sessionSecret);
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

async function handleImageProxy(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  fetchImpl: typeof fetch,
): Promise<void> {
  if (request.method !== "GET") {
    methodNotAllowed(response);
    return;
  }

  const targetValue = url.searchParams.get("url") ?? "";
  const targetUrl = parsePublicImageUrl(targetValue);

  if (!targetUrl) {
    jsonResponse(response, 400, {
      ok: false,
      error: "Invalid image proxy URL.",
    });
    return;
  }

  const upstream = await fetchPublicImage(targetUrl, fetchImpl);
  const contentType = upstream.headers.get("content-type") ?? "";

  if (!upstream.ok || !contentType.toLowerCase().startsWith("image/")) {
    jsonResponse(response, 502, {
      ok: false,
      error: "Image proxy target did not return an image.",
    });
    return;
  }

  const bytes = Buffer.from(await upstream.arrayBuffer());

  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "public, max-age=86400",
    "content-length": String(bytes.byteLength),
    "x-content-type-options": "nosniff",
  });
  response.end(bytes);
}

async function fetchPublicImage(
  targetUrl: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  let currentUrl = targetUrl;

  for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
    const upstream = await fetchImpl(new Request(currentUrl, { redirect: "manual" }));

    if (![301, 302, 303, 307, 308].includes(upstream.status)) {
      return upstream;
    }

    const location = upstream.headers.get("location");

    if (!location) {
      return upstream;
    }

    const nextUrl = parsePublicImageUrl(new URL(location, currentUrl).toString());

    if (!nextUrl) {
      return new Response("Blocked image redirect.", { status: 400 });
    }

    currentUrl = nextUrl;
  }

  return new Response("Too many image redirects.", { status: 400 });
}

function parsePublicImageUrl(value: string): string | null {
  try {
    const url = new URL(value);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    if (isBlockedImageProxyHostname(url.hostname)) {
      return null;
    }

    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isBlockedImageProxyHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  ) {
    return true;
  }

  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);

  if (!ipv4) {
    return false;
  }

  const first = Number(ipv4[1]);
  const second = Number(ipv4[2]);

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isOAuthMetadataPath(pathname: string): boolean {
  return [
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
    "/.well-known/oauth-protected-resource",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function handleOAuthMetadata(
  request: IncomingMessage,
  response: ServerResponse,
  options: RequestHandlerOptions,
): void {
  if (request.method !== "GET") {
    methodNotAllowed(response);
    return;
  }

  const issuer = publicBaseUrl(request, options);
  const requestUrl = new URL(request.url ?? "/", issuer);
  const resource = metadataResourceFromPath(requestUrl.pathname, issuer) ?? issuer;

  jsonResponse(response, 200, {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    jwks_uri: `${issuer}/oauth/jwks`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256", "plain"],
    scopes_supported: ["mcp"],
    resource,
    authorization_servers: [issuer],
  });
}

async function handleOAuthRegister(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== "POST") {
    methodNotAllowed(response);
    return;
  }

  const body = await readAnyRequest(request);
  const redirectUris = arrayOfStrings(body.redirect_uris) ?? [];

  jsonResponse(response, 201, {
    client_id: `slimweb-client-mcp-${randomBytes(8).toString("hex")}`,
    client_name: stringValue(body.client_name) ?? "ChatGPT",
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}

async function handleOAuthAuthorize(
  request: IncomingMessage,
  response: ServerResponse,
  options: RequestHandlerOptions,
  sessionSecret: string,
): Promise<void> {
  if (request.method !== "GET") {
    methodNotAllowed(response);
    return;
  }

  const url = new URL(request.url ?? "/", publicBaseUrl(request, options));
  const params = oauthParamsFromSearch(url.searchParams);
  const validation = validateOAuthAuthorizeParams(params);

  if (validation) {
    htmlResponse(response, 400, `<p>${escapeHtml(validation)}</p>`);
    return;
  }

  const siteCode = siteCodeFromResource(params.resource);

  if (!siteCode) {
    htmlResponse(response, 400, "<p>Missing SlimWeb site MCP resource.</p>");
    return;
  }

  const session = verifySessionToken(readSessionToken({
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
  }), sessionSecret);

  if (!session || session.callback_code !== siteCode) {
    const next = sameOriginNextPath(`${url.pathname}${url.search}`);

    redirectResponse(response, `/auth/login?next=${encodeURIComponent(next)}`);
    return;
  }

  const redirectUrl = new URL(params.redirectUri);
  redirectUrl.searchParams.set("code", createOAuthCode(session, params, sessionSecret));

  if (params.state) {
    redirectUrl.searchParams.set("state", params.state);
  }

  redirectResponse(response, redirectUrl.toString());
}

function handleAuthLogin(
  request: IncomingMessage,
  response: ServerResponse,
  options: RequestHandlerOptions,
): void {
  if (request.method !== "GET") {
    methodNotAllowed(response);
    return;
  }

  const url = new URL(request.url ?? "/", publicBaseUrl(request, options));
  const next = sameOriginNextPath(url.searchParams.get("next"));

  htmlResponse(response, 200, googleSignInPage(next, options));
}

async function handleAuthGoogle(
  request: IncomingMessage,
  response: ServerResponse,
  options: RequestHandlerOptions,
  verifier: GoogleVerifier,
  repository: SiteMemberRepository,
  sessionSecret: string,
): Promise<void> {
  if (request.method !== "POST") {
    methodNotAllowed(response);
    return;
  }

  const body = await readAnyRequest(request);
  const next = sameOriginNextPath(stringValue(body.next));
  const nextUrl = new URL(next, publicBaseUrl(request, options));
  const params = oauthParamsFromSearch(nextUrl.searchParams);
  const validation = validateOAuthAuthorizeParams(params);

  if (validation) {
    jsonResponse(response, 400, { ok: false, error: validation });
    return;
  }

  const siteCode = siteCodeFromResource(params.resource);

  if (!siteCode) {
    jsonResponse(response, 400, { ok: false, error: "Missing SlimWeb site MCP resource." });
    return;
  }

  const site = await repository.findSiteByCallbackCode(siteCode);

  if (!site) {
    jsonResponse(response, 404, { ok: false, error: "Unknown SlimWeb site MCP code." });
    return;
  }

  const credential = stringValue(body.credential) ?? "";
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

  jsonResponse(response, 200, {
    ok: true,
    next,
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
  }, {
    "set-cookie": sessionCookie(token, process.env.NODE_ENV === "production"),
  });
}

async function handleOAuthGoogle(
  request: IncomingMessage,
  response: ServerResponse,
  options: RequestHandlerOptions,
  verifier: GoogleVerifier,
  repository: SiteMemberRepository,
  sessionSecret: string,
): Promise<void> {
  if (request.method !== "POST") {
    methodNotAllowed(response);
    return;
  }

  const body = await readAnyRequest(request);
  const params = oauthParamsFromRecord(body);
  const validation = validateOAuthAuthorizeParams(params);

  if (validation) {
    htmlResponse(response, 400, `<p>${escapeHtml(validation)}</p>`);
    return;
  }

  const siteCode = siteCodeFromResource(params.resource);

  if (!siteCode) {
    htmlResponse(response, 400, "<p>Missing SlimWeb site MCP resource.</p>");
    return;
  }

  const site = await repository.findSiteByCallbackCode(siteCode);

  if (!site) {
    htmlResponse(response, 404, "<p>Unknown SlimWeb site MCP code.</p>");
    return;
  }

  const credential = stringValue(body.credential) ?? "";
  const profile = await verifier.verify(credential);
  const member = await repository.provisionMember(site.id, profile);
  const accessToken = createSessionToken(
    {
      site_id: site.id,
      callback_code: site.callbackCode,
      member_id: member.id,
      email: member.email,
      google_id: member.googleId,
    },
    sessionSecret,
  );
  const code = createSignedToken(
    {
      typ: "oauth_code",
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      code_challenge_method: params.codeChallengeMethod,
      access_token: accessToken,
      exp: Math.floor(Date.now() / 1000) + 10 * 60,
    },
    sessionSecret,
  );
  const redirectUrl = new URL(params.redirectUri);
  redirectUrl.searchParams.set("code", code);

  if (params.state) {
    redirectUrl.searchParams.set("state", params.state);
  }

  redirectResponse(response, redirectUrl.toString(), {
    "set-cookie": sessionCookie(accessToken, process.env.NODE_ENV === "production"),
  });
}

async function handleOAuthToken(
  request: IncomingMessage,
  response: ServerResponse,
  sessionSecret: string,
): Promise<void> {
  if (request.method !== "POST") {
    methodNotAllowed(response);
    return;
  }

  const body = await readAnyRequest(request);

  if (stringValue(body.grant_type) !== "authorization_code") {
    jsonResponse(response, 400, { error: "unsupported_grant_type" });
    return;
  }

  const code = stringValue(body.code) ?? "";
  const payload = verifySignedToken(code, sessionSecret);

  if (
    !payload ||
    payload.typ !== "oauth_code" ||
    typeof payload.exp !== "number" ||
    payload.exp < Math.floor(Date.now() / 1000) ||
    typeof payload.site_id !== "number" ||
    typeof payload.callback_code !== "string" ||
    typeof payload.member_id !== "number" ||
    typeof payload.email !== "string" ||
    typeof payload.google_id !== "string" ||
    typeof payload.redirect_uri !== "string" ||
    typeof payload.client_id !== "string" ||
    typeof payload.code_challenge !== "string" ||
    typeof payload.code_challenge_method !== "string"
  ) {
    jsonResponse(response, 400, { error: "invalid_grant" });
    return;
  }

  if (
    stringValue(body.redirect_uri) !== payload.redirect_uri ||
    stringValue(body.client_id) !== payload.client_id
  ) {
    jsonResponse(response, 400, { error: "invalid_grant" });
    return;
  }

  const verifier = stringValue(body.code_verifier) ?? "";

  if (!verifyPkce(verifier, payload.code_challenge, payload.code_challenge_method)) {
    jsonResponse(response, 400, { error: "invalid_grant" });
    return;
  }

  const accessToken = createSessionToken(
    {
      site_id: payload.site_id,
      callback_code: payload.callback_code,
      member_id: payload.member_id,
      email: payload.email,
      google_id: payload.google_id,
    },
    sessionSecret,
  );

  jsonResponse(response, 200, {
    token_type: "Bearer",
    access_token: accessToken,
    expires_in: 60 * 60 * 24 * 7,
    scope: stringValue(payload.scope) ?? "mcp",
  }, {
    "cache-control": "no-store",
    pragma: "no-cache",
  });
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

  const params =
    message.params && typeof message.params === "object"
      ? (message.params as Record<string, unknown>)
      : {};
  const toolName = String(params.name ?? "");
  let session = verifySessionToken(
    readSessionToken({
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    }),
    sessionSecret,
  );

  if (session && (session.callback_code !== site.callbackCode || session.site_id !== site.id)) {
    session = null;
  }

  if (message.method === "tools/call" && toolRequiresSession(toolName) && !session) {
    const resourceMetadata = protectedResourceMetadataUrl(request, site);

    jsonResponse(
      response,
      401,
      mcpError(message.id ?? null, -32001, "Google login required for this site MCP.", {
        reason: "AUTH_REQUIRED",
        resource_metadata: resourceMetadata,
      }),
      {
        "www-authenticate": protectedResourceChallenge(resourceMetadata),
        "cache-control": "no-store",
      },
    );
    return;
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
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
        },
        serverInfo: { name: "slimweb-client-mcp", version: "0.1.0" },
      });

    case "tools/list": {
      const registry = createSiteRegistry(site, options);
      return mcpResult(id, { tools: registry.listTools().map(toolForMcp) });
    }

    case "resources/list": {
      return mcpResult(id, { resources: [productListWidgetResource(), productImagesWidgetResource()] });
    }

    case "resources/read": {
      const params =
        message.params && typeof message.params === "object"
          ? (message.params as Record<string, unknown>)
          : {};
      const uri = String(params.uri ?? "");

      if (uri === PRODUCT_LIST_WIDGET_URI) {
        return mcpResult(id, { contents: [productListWidgetContents()] });
      }

      if (uri === PRODUCT_IMAGES_WIDGET_URI) {
        return mcpResult(id, { contents: [productImagesWidgetContents()] });
      }

      return mcpError(id, -32002, `Unknown MCP resource: ${uri}`);
    }

    case "tools/call": {
      const params =
        message.params && typeof message.params === "object"
          ? (message.params as Record<string, unknown>)
          : {};
      const registry = createSiteRegistry(site, options, session);
      let result;

      try {
        result = await registry.callTool(
          String(params.name ?? ""),
          params.arguments ?? {},
        );
      } catch (error) {
        if (error instanceof ZodError) {
          return mcpError(id, -32602, `Invalid arguments for ${String(params.name ?? "")}.`, {
            reason: "INVALID_TOOL_ARGUMENTS",
            issues: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          });
        }

        if (error instanceof WeblessRequestError) {
          console.warn("webless_tool_request_failed", {
            tool: String(params.name ?? ""),
            status: error.status,
            url: redactUrl(error.url),
            body: error.body,
          });

          return mcpError(id, -32010, error.message, {
            reason: "WEBLESS_REQUEST_FAILED",
            webless_status: error.status,
            webless_body: safeErrorBody(error.body),
          });
        }

        throw error;
      }

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
    session
      ? {
          authenticated: true,
          customer: {
            id: session.member_id,
            email: session.email,
            google_id: session.google_id,
          },
        }
      : undefined,
  );
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);

    if (url.searchParams.has("member_id")) {
      url.searchParams.set("member_id", "[redacted]");
    }

    return url.toString();
  } catch {
    return value;
  }
}

function safeErrorBody(body: unknown): unknown {
  if (typeof body === "string") {
    return body.slice(0, 500);
  }

  if (!body || typeof body !== "object") {
    return body;
  }

  return body;
}

function toolRequiresSession(toolName: string): boolean {
  return [
    "client_order_list",
    "client_customer_context",
    "client_order_preview",
    "client_checkout_start",
    "client_checkout_status",
  ].includes(toolName);
}

function toolForMcp(tool: ReturnType<ReturnType<typeof createToolRegistry>["listTools"]>[number]) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: inputSchemaForTool(tool.name),
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
    _meta: tool._meta,
  };
}

function inputSchemaForTool(toolName: string) {
  if (toolName === "client_catalog_search") {
    return {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 5 },
        minPrice: { type: "number", minimum: 0 },
        maxPrice: { type: "number", minimum: 0 },
        freshness: { type: "string", enum: ["latest"] },
        popularity: { type: "string", enum: ["popular"] },
        priceOrder: { type: "string", enum: ["asc", "desc"] },
      },
      required: ["query"],
    };
  }

  if (toolName === "client_product_cards") {
    return {
      type: "object",
      properties: {
        productIds: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: { type: "string" },
        },
      },
      required: ["productIds"],
    };
  }

  if (toolName === "client_product_detail" || toolName === "client_product_images") {
    return {
      type: "object",
      properties: {
        productId: { type: "string" },
      },
      required: ["productId"],
    };
  }

  if (toolName === "client_product_verify") {
    return {
      type: "object",
      properties: {
        productId: { type: "string" },
        quantity: { type: "number", minimum: 1, maximum: 99 },
      },
      required: ["productId"],
    };
  }

  if (toolName === "client_order_list") {
    return {
      type: "object",
      properties: {
        status: { type: "string", enum: ["all", "pending", "completed"] },
        limit: { type: "number", minimum: 1, maximum: 20 },
      },
    };
  }

  if (toolName === "client_customer_context") {
    return {
      type: "object",
      properties: {},
    };
  }

  if (toolName === "client_order_preview" || toolName === "client_checkout_start") {
    const properties: Record<string, unknown> = {
      items: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            productId: { type: "number", minimum: 1 },
            quantity: { type: "number", minimum: 1, maximum: 99 },
          },
          required: ["productId", "quantity"],
        },
      },
      buyerName: { type: "string" },
      buyerPhone: { type: "string" },
      recipientName: { type: "string" },
      recipientPhone: { type: "string" },
      recipientAddress: { type: "string" },
    };

    if (toolName === "client_checkout_start") {
      properties.paymentMethod = { type: "string", enum: ["online", "pickup_pay", "cod"] };
      properties.logisticsMethod = { type: "string", enum: ["home_delivery", "cvs_pickup"] };
      properties.reusePreviousStore = { type: "boolean" };
      properties.confirmBeforeCreate = { type: "boolean" };
    }

    return {
      type: "object",
      properties,
      required: [
        "items",
        "buyerName",
        "buyerPhone",
        "recipientName",
        "recipientPhone",
        "recipientAddress",
        ...(toolName === "client_checkout_start" ? ["paymentMethod", "logisticsMethod"] : []),
      ],
    };
  }

  if (toolName === "client_checkout_status") {
    return {
      type: "object",
      properties: {
        checkoutToken: { type: "string" },
      },
      required: ["checkoutToken"],
    };
  }

  return {
    type: "object",
    properties: {},
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

async function readAnyRequest(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const text = Buffer.concat(chunks).toString("utf8");
  const contentType = request.headers["content-type"] ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text).entries());
  }

  if (contentType.includes("application/json")) {
    return JSON.parse(text);
  }

  return Object.fromEntries(new URLSearchParams(text).entries());
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

function htmlResponse(
  response: ServerResponse,
  status: number,
  body: string,
): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
  });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>SlimWeb Client MCP</title></head><body>${body}</body></html>`);
}

function redirectResponse(
  response: ServerResponse,
  location: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(302, {
    location,
    ...headers,
  });
  response.end();
}

function methodNotAllowed(response: ServerResponse): void {
  jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
}

function mcpResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function mcpError(
  id: unknown,
  code: number,
  message: string,
  data?: Record<string, unknown>,
) {
  return {
    jsonrpc: "2.0",
    id,
    error: data ? { code, message, data } : { code, message },
  };
}

interface OAuthAuthorizeParams {
  clientId: string;
  redirectUri: string;
  responseType: string;
  state: string;
  resource: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

function oauthParamsFromSearch(searchParams: URLSearchParams): OAuthAuthorizeParams {
  return {
    clientId: searchParams.get("client_id") ?? "",
    redirectUri: searchParams.get("redirect_uri") ?? "",
    responseType: searchParams.get("response_type") ?? "",
    state: searchParams.get("state") ?? "",
    resource: searchParams.get("resource") ?? "",
    codeChallenge: searchParams.get("code_challenge") ?? "",
    codeChallengeMethod: searchParams.get("code_challenge_method") ?? "plain",
  };
}

function oauthParamsFromRecord(record: Record<string, unknown>): OAuthAuthorizeParams {
  return {
    clientId: stringValue(record.client_id) ?? "",
    redirectUri: stringValue(record.redirect_uri) ?? "",
    responseType: stringValue(record.response_type) ?? "",
    state: stringValue(record.state) ?? "",
    resource: stringValue(record.resource) ?? "",
    codeChallenge: stringValue(record.code_challenge) ?? "",
    codeChallengeMethod: stringValue(record.code_challenge_method) ?? "plain",
  };
}

function validateOAuthAuthorizeParams(params: OAuthAuthorizeParams): string | null {
  if (!params.clientId) return "Missing OAuth client_id.";
  if (!params.redirectUri) return "Missing OAuth redirect_uri.";
  if (params.responseType !== "code") return "Unsupported OAuth response_type.";
  if (!params.resource) return "Missing OAuth resource.";
  if (!params.codeChallenge) return "Missing OAuth PKCE code_challenge.";
  if (!["S256", "plain"].includes(params.codeChallengeMethod)) {
    return "Unsupported OAuth PKCE code_challenge_method.";
  }

  try {
    new URL(params.redirectUri);
    new URL(params.resource);
  } catch {
    return "Invalid OAuth URL parameter.";
  }

  return null;
}

function siteCodeFromResource(resource: string): string | null {
  try {
    const url = new URL(resource);
    const match = url.pathname.match(/^\/sites\/([^/]+)\/mcp$/);

    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function createOAuthCode(
  session: ClientSessionPayload,
  params: OAuthAuthorizeParams,
  secret: string,
): string {
  const now = Math.floor(Date.now() / 1000);

  return createSignedToken(
    {
      typ: "oauth_code",
      site_id: session.site_id,
      callback_code: session.callback_code,
      member_id: session.member_id,
      email: session.email,
      google_id: session.google_id,
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      scope: "mcp",
      code_challenge: params.codeChallenge,
      code_challenge_method: params.codeChallengeMethod,
      iat: now,
      exp: now + 10 * 60,
    },
    secret,
  );
}

function sameOriginNextPath(next: string | null | undefined): string {
  if (!next) {
    return "/auth/success";
  }

  try {
    if (next.startsWith("/")) {
      const parsed = new URL(next, "https://local.invalid");

      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    const parsed = new URL(next);

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/auth/success";
  }
}

function googleSignInPage(
  next: string,
  options: RequestHandlerOptions,
): string {
  const clientId = options.config.googleClientId ??
    "27587628711-upin8ch154kqrl88k41978q660oc0pbg.apps.googleusercontent.com";

  return `
    <main style="font-family: system-ui, sans-serif; max-width: 420px; margin: 48px auto; line-height: 1.5;">
      <h1>SlimWeb Client MCP</h1>
      <p>請使用 Google 登入以連接此站台的消費者 MCP。</p>
      <script src="https://accounts.google.com/gsi/client" async defer></script>
      <div id="g_id_onload"
        data-client_id="${escapeHtml(clientId)}"
        data-context="signin"
        data-ux_mode="popup"
        data-callback="slimwebClientMcpGoogle"
        data-auto_prompt="false"></div>
      <div class="g_id_signin" data-type="standard" data-size="large" data-theme="outline" data-text="signin_with" data-shape="rectangular"></div>
      <script>
        async function slimwebClientMcpGoogle(response) {
          const result = await fetch('/auth/google', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              credential: response.credential,
              next: ${JSON.stringify(next)}
            })
          });
          const payload = await result.json().catch(function() { return {}; });
          if (!result.ok) {
            alert('登入失敗：' + (payload.error || '請重新再試。'));
            return;
          }
          window.location.href = payload.next || ${JSON.stringify(next)};
        }
      </script>
    </main>
  `;
}

function verifyPkce(
  verifier: string,
  challenge: string,
  method: string,
): boolean {
  if (!verifier) return false;
  if (method === "plain") return verifier === challenge;

  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

function publicBaseUrl(
  request: IncomingMessage,
  options: RequestHandlerOptions,
): string {
  if (options.config.publicBaseUrl) {
    return options.config.publicBaseUrl;
  }

  const proto = String(request.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();
  const host = request.headers.host ?? "localhost";

  return `${proto}://${host}`;
}

function protectedResourceMetadataUrl(
  request: IncomingMessage,
  site: ClientSite,
): string {
  const proto = String(request.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();
  const host = request.headers.host ?? "localhost";

  return `${proto}://${host}/.well-known/oauth-protected-resource/sites/${encodeURIComponent(site.callbackCode)}/mcp`;
}

function protectedResourceChallenge(resourceMetadataUrl: string): string {
  return `Bearer resource_metadata="${resourceMetadataUrl}"`;
}

function metadataResourceFromPath(pathname: string, issuer: string): string | null {
  for (const prefix of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
    "/.well-known/oauth-protected-resource",
  ]) {
    if (pathname.startsWith(`${prefix}/`)) {
      const resourcePath = pathname.slice(prefix.length);

      return `${issuer}${resourcePath}`;
    }
  }

  return null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
