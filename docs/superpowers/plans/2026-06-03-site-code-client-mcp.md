# Site-Code Client MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement site-code Client MCP routing, Google member provisioning, Webless copyable URL, and AI-facing documentation.

**Architecture:** Client MCP becomes an HTTP Cloud Run service with `/sites/{callback_code}/mcp` and site-scoped Google login. Webless displays the generated public URL. SlimWeb-MCP and SlimWeb-MCP-Skill describe the consumer endpoint without owning customer runtime behavior.

**Tech Stack:** Node.js 20/TypeScript, Node test runner, PostgreSQL via `pg`, Laravel/Vue/Tailwind, Markdown skill docs.

---

### Task 1: Client MCP HTTP And Auth

**Files:**
- Create: `src/app.ts`
- Create: `src/google-verifier.ts`
- Create: `src/session.ts`
- Create: `src/site-member-repository.ts`
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Modify: `package.json`
- Create: `test/app.test.ts`

- [ ] Write failing tests for `/sites/{callback_code}/auth/google`, `/sites/{callback_code}/mcp` tools/list, and unauthenticated tools/call.
- [ ] Implement Google verifier, signed session tokens, site/member repository, and HTTP handler.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`.

### Task 2: Client MCP Deployment Shape

**Files:**
- Create: `Dockerfile`
- Create: `cloudbuild.yaml`
- Modify: `README.md`

- [ ] Add Cloud Run deployment files matching SlimWeb-MCP shape with service name `slimweb-client-mcp`.
- [ ] Document `SLIMWEB_CLIENT_MCP_BASE_URL`, DB, Google, and session env vars.

### Task 3: Webless Basic Settings URL

**Files:**
- Modify: `/Users/eric/Documents/webless/app/Http/Controllers/SiteAdminController.php`
- Modify: `/Users/eric/Documents/webless/resources/js/pages/SiteAdminDashboardPage.vue`
- Modify: `/Users/eric/Documents/webless/app/Support/UiText.php`

- [ ] Add `clientMcpUrl` to site payloads.
- [ ] Display it as a read-only field with copy button in basic settings.
- [ ] Preserve Traditional Chinese/English copy behavior through existing `copy` props.

### Task 4: SlimWeb-MCP Awareness And Skill Docs

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/weblessRepository.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/app.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP-Skill/SKILL.md`
- Modify: `/Users/eric/Documents/SlimWeb-MCP-Skill/chatgpt-knowledge/slimweb-mcp-ai-guide.md`

- [ ] Surface `client_mcp_url` in site data returned to AI.
- [ ] Document that this is a customer-facing MCP URL that auto-creates site members after Google login.
