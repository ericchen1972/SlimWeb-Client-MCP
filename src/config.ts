export interface ClientMcpConfig {
  baseUrl: string;
  siteKey?: string;
  sessionSecret?: string;
  publicBaseUrl?: string;
  googleClientId?: string;
  port?: number;
  host?: string;
}

export interface ConfigEnv {
  WEBLESS_BASE_URL?: string;
  WEBLESS_SITE_KEY?: string;
  MCP_SESSION_SECRET?: string;
  PUBLIC_BASE_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  PORT?: string;
  HOST?: string;
}

export function loadConfig(env: ConfigEnv = process.env): ClientMcpConfig {
  const rawBaseUrl = env.WEBLESS_BASE_URL?.trim();

  if (!rawBaseUrl) {
    throw new Error("WEBLESS_BASE_URL is required");
  }

  const config: ClientMcpConfig = {
    baseUrl: rawBaseUrl.replace(/\/+$/, ""),
  };

  if (env.WEBLESS_SITE_KEY?.trim()) {
    config.siteKey = env.WEBLESS_SITE_KEY.trim();
  }

  if (env.MCP_SESSION_SECRET?.trim()) {
    config.sessionSecret = env.MCP_SESSION_SECRET.trim();
  }

  if (env.PUBLIC_BASE_URL?.trim()) {
    config.publicBaseUrl = env.PUBLIC_BASE_URL.trim().replace(/\/+$/, "");
  }

  if (env.GOOGLE_CLIENT_ID?.trim()) {
    config.googleClientId = env.GOOGLE_CLIENT_ID.trim();
  }

  if (env.PORT?.trim()) {
    config.port = Number.parseInt(env.PORT, 10);
  }

  if (env.HOST?.trim()) {
    config.host = env.HOST.trim();
  }

  return config;
}
