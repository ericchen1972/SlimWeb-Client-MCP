# SlimWeb Client MCP

Consumer-side MCP server for Webless storefront operations.

This repo is separate from:

- `/Users/eric/Documents/SlimWeb-MCP`: site/admin/theme MCP service.
- `/Users/eric/Documents/SlimWeb-MCP-Skill`: docs-only operating guidance.
- `/Users/eric/Documents/webless`: Laravel runtime and source of business truth.

## Tools

- `client_catalog_overview`: list customer-visible storefront category paths
  and product counts. AI clients should use this first when a shopper's request
  is broad or ambiguous.
- `client_catalog_search`: search customer-visible storefront products by
  product text or category after the shopper intent is clear. Optional filters
  include quantity `limit` (default 3, max 10), `minPrice`, `maxPrice`,
  `freshness=latest`, `popularity=popular`, and `priceOrder=asc|desc`. AI
  clients should show `image_url` as product images and include `product_url`.
- `client_product_detail`: fetch a customer-visible product detail.
- `client_order_lookup`: fetch a customer-visible order summary by token.

Merchant-only operations and provider callback truth remain in Webless. This
service does not complete refunds, request provider refunds, process logistics
callbacks, or mutate admin order state.

## Public URL

Each site uses its existing Webless `sites.callback_code` as the public MCP
handle:

```text
https://<slimweb-client-mcp-host>/sites/{callback_code}/mcp
```

Example:

```text
https://slimweb-client-mcp.example.run.app/sites/swcb_zog0l7zlyp3lwmlc/mcp
```

The request host does not determine the site. Custom storefront domains do not
change routing; the site is resolved only from `{callback_code}`.

Google login is posted to:

```text
https://<slimweb-client-mcp-host>/sites/{callback_code}/auth/google
```

After Google verification, the service finds or creates a Webless `members`
record for that site.

ChatGPT Web remote MCP connections should use OAuth. The service exposes OAuth
metadata at:

```text
https://<slimweb-client-mcp-host>/.well-known/oauth-authorization-server
```

The OAuth flow signs the customer in with Google, creates or links the Webless
site member, and returns a bearer token that is accepted by the MCP endpoint.

## Configuration

Set these environment variables before launching the MCP server:

```bash
export WEBLESS_BASE_URL="https://your-webless-host.example"
export MCP_SESSION_SECRET="change-me"
export PUBLIC_BASE_URL="https://slimweb-client-mcp.example.run.app"
export GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
```

Database connection uses either `DATABASE_URL` or the `DB_HOST`, `DB_PORT`,
`DB_DATABASE`, `DB_USERNAME`, and `DB_PASSWORD` variables. These point at the
same Webless database that owns `sites` and `members`.

## Local Commands

```bash
npm install
npm test
npm run typecheck
npm run build
```

Run HTTP locally:

```bash
npm run build
WEBLESS_BASE_URL="https://your-webless-host.example" MCP_SESSION_SECRET="dev-secret" node dist/src/index.js
```
