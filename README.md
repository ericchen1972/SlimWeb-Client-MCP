# SlimWeb Client MCP

Consumer-side MCP server for Webless storefront operations.

This repo is separate from:

- `/Users/eric/Documents/SlimWeb-MCP`: site/admin/theme MCP service.
- `/Users/eric/Documents/SlimWeb-MCP-Skill`: docs-only operating guidance.
- `/Users/eric/Documents/webless`: Laravel runtime and source of business truth.

## Tools

- `client_catalog_search`: search customer-visible storefront catalog data.
- `client_product_detail`: fetch a customer-visible product detail.
- `client_order_lookup`: fetch a customer-visible order summary by token.

Merchant-only operations and provider callback truth remain in Webless. This
service does not complete refunds, request provider refunds, process logistics
callbacks, or mutate admin order state.

## Configuration

Set these environment variables before launching the MCP server:

```bash
export WEBLESS_BASE_URL="https://your-webless-host.example"
export WEBLESS_SITE_KEY="site-1"
```

`WEBLESS_SITE_KEY` is optional. When present, the client appends it as `site` to
storefront requests.

## Local Commands

```bash
npm install
npm test
npm run typecheck
npm run build
```

Run over stdio:

```bash
npm run build
WEBLESS_BASE_URL="https://your-webless-host.example" node dist/src/index.js
```
