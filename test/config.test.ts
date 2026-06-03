import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";

test("loadConfig normalizes the Webless base URL and optional site key", () => {
  const config = loadConfig({
    WEBLESS_BASE_URL: "https://example.test/",
    WEBLESS_SITE_KEY: "site-1",
  });

  assert.deepEqual(config, {
    baseUrl: "https://example.test",
    siteKey: "site-1",
  });
});

test("loadConfig rejects a missing Webless base URL", () => {
  assert.throws(
    () => loadConfig({}),
    /WEBLESS_BASE_URL is required/,
  );
});
