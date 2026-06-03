# Client MCP Initial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first testable TypeScript MCP server skeleton for Webless consumer-side tools.

**Architecture:** Keep MCP protocol wiring separate from tool definitions and Webless HTTP access. Tools expose customer-facing catalog/order operations while leaving callbacks and merchant-only state changes in Webless.

**Tech Stack:** Node.js 20, TypeScript, Node test runner, MCP TypeScript SDK.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] Create Node/TypeScript project metadata.
- [ ] Install runtime and development dependencies.

### Task 2: Test-First Core Units

**Files:**
- Create: `test/config.test.ts`
- Create: `test/webless-client.test.ts`
- Create: `test/tools.test.ts`
- Create: `src/config.ts`
- Create: `src/webless-client.ts`
- Create: `src/tools.ts`

- [ ] Write failing tests for config parsing, request construction, and tool dispatch.
- [ ] Run tests and confirm they fail because implementation files are missing.
- [ ] Implement the smallest code that satisfies the tests.
- [ ] Run tests and confirm they pass.

### Task 3: MCP Server Wiring

**Files:**
- Create: `src/server.ts`
- Create: `src/index.ts`
- Modify: `README.md`

- [ ] Wire the MCP SDK stdio transport to the tool registry.
- [ ] Document environment variables and local commands.
- [ ] Run typecheck, tests, and build.
