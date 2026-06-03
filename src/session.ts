import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "swcmcp_session";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface ClientSessionPayload {
  site_id: number;
  callback_code: string;
  member_id: number;
  email: string;
  google_id: string;
  exp: number;
  iat?: number;
}

export function createSessionToken(
  payload: Omit<ClientSessionPayload, "exp" | "iat">,
  secret: string,
  now = Date.now(),
): string {
  const issuedAt = Math.floor(now / 1000);

  return createSignedToken(
    {
      ...payload,
      iat: issuedAt,
      exp: issuedAt + DEFAULT_TTL_SECONDS,
    },
    secret,
  );
}

export function createSignedToken(payload: object, secret: string): string {
  if (!secret) {
    throw new Error("MCP_SESSION_SECRET is required");
  }

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = sign(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  now = Date.now(),
): ClientSessionPayload | null {
  const payload = verifySignedToken(token, secret);

  if (
    !payload ||
    typeof payload !== "object" ||
    !("exp" in payload) ||
    typeof payload.exp !== "number" ||
    payload.exp < Math.floor(now / 1000)
  ) {
    return null;
  }

  if (
    typeof payload.site_id !== "number" ||
    typeof payload.callback_code !== "string" ||
    typeof payload.member_id !== "number" ||
    typeof payload.email !== "string" ||
    typeof payload.google_id !== "string"
  ) {
    return null;
  }

  return payload as unknown as ClientSessionPayload;
}

export function readSessionToken(headers: HeadersLike): string {
  const authorization = headers.authorization ?? "";

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  const cookieHeader = headers.cookie ?? "";
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  const cookie = cookies.find((part) => part.startsWith(`${COOKIE_NAME}=`));

  return cookie ? decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)) : "";
}

export function sessionCookie(token: string, secure = true): string {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${DEFAULT_TTL_SECONDS}`,
  ];

  if (secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function verifySignedToken(token: string, secret: string): Record<string, unknown> | null {
  if (!token || !secret || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".", 2);
  const expected = sign(encodedPayload, secret);

  if (!safeEqual(signature, expected)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

interface HeadersLike {
  authorization?: string;
  cookie?: string;
}
