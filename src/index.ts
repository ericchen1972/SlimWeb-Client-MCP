#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { runStdioServer } from "./server.js";

runStdioServer(loadConfig()).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
