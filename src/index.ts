#!/usr/bin/env node

import { createServer } from "node:http";

import { createRequestHandler } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const port = config.port ?? 8080;
const host = config.host ?? "0.0.0.0";
const server = createServer(createRequestHandler({ config }));

server.listen(port, host, () => {
  console.log(`slimweb-client-mcp listening on ${host}:${port}`);
});

function shutdown(signal: string): void {
  console.log(`received ${signal}, shutting down`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
