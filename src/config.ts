export interface ClientMcpConfig {
  baseUrl: string;
  siteKey?: string;
}

export interface ConfigEnv {
  WEBLESS_BASE_URL?: string;
  WEBLESS_SITE_KEY?: string;
}

export function loadConfig(env: ConfigEnv = process.env): ClientMcpConfig {
  const rawBaseUrl = env.WEBLESS_BASE_URL?.trim();

  if (!rawBaseUrl) {
    throw new Error("WEBLESS_BASE_URL is required");
  }

  return {
    baseUrl: rawBaseUrl.replace(/\/+$/, ""),
    siteKey: env.WEBLESS_SITE_KEY?.trim() || undefined,
  };
}
