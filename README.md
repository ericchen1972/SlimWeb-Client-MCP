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
  product text or category as a recommendation candidate pool after the
  shopper intent is clear. Optional filters include `limit` (default 2, max 5),
  `minPrice`, `maxPrice`, `freshness=latest`, `popularity=popular`, and
  `priceOrder=asc|desc`. For recommendations, AI clients should usually fetch a
  broader candidate pool, inspect the returned structured data, then choose the
  final products according to the conversation and shopper preferences. If the
  shopper asks for a specific final count, select exactly that many; otherwise
  select 2.
- `client_product_cards`: render product cards for products the AI already
  selected from candidate results. Pass only the final `productIds` so the
  `ui://widget/product-list.html` widget shows recommendations instead of the
  entire search candidate pool.
- `client_product_detail`: fetch one customer-visible product detail. The
  result includes the primary `image_url`, `image_count`, and
  `has_image_gallery`; it does not include the full gallery image array.
- `client_product_images`: render customer-visible product gallery images for
  one product id through `ui://widget/product-images.html`.
- `client_product_verify`: verify current product availability, stock, price,
  and line total before checkout.
- `client_order_list`: list the signed-in customer's recent orders.
- `client_customer_context`: fetch signed-in customer context, including the
  last order when available.
- `client_order_preview`: build a checkout confirmation preview. This does not
  create an order.

Merchant-only operations and provider callback truth remain in Webless. This
service does not complete refunds, request provider refunds, process logistics
callbacks, or mutate admin order state.

## Customer Checkout Flow

SlimWeb-Client checkout should use an order draft, also called a checkout
session, before creating the final Webless order. The MCP should not create a
formal order until the required shipping, payment, recipient, price, and stock
data have been confirmed.

### Core Rule

Use a checkout session for AI-driven checkout:

1. The shopper asks to buy or reorder products.
2. The MCP identifies products from search results or the customer's order
   history.
3. The MCP verifies current product price, stock, buy limits, shipping fee, and
   recipient data.
4. The MCP creates or previews a checkout session with status such as
   `draft`, `waiting_store_selection`, `waiting_payment`, or `ready_to_create`.
5. Webless creates the formal order only after all required logistics and
   payment inputs are present.
6. Provider callbacks and redirects update Webless order/payment/logistics
   state. The MCP reads that state with status tools instead of acting as a
   callback receiver.

The checkout session is identified by a high-entropy, short-lived token. The
token is bound to the site, signed-in member, products, quantities, recipient
fields, payment method, logistics method, and calculated totals. The token must
expire, be single-purpose, and be revalidated server-side before a formal order
is created.

### Home Delivery With Online Payment

When the shopper chooses home delivery and online payment, no external store
selection is needed.

1. MCP verifies the products and recipient data.
2. MCP builds a checkout session and confirmation preview.
3. Shopper confirms in chat.
4. Webless creates the formal order.
5. Webless redirects the shopper to the payment provider.
6. Payment callback updates the order payment state.
7. Shopper returns to the SlimWeb completion page.

The MCP should not mark the payment as complete. Provider callback state is the
source of truth.

### Convenience Store Pickup With Online Payment

For online payment plus convenience store pickup, store selection is required
before the formal order can be created.

1. MCP verifies the products and known customer/recipient data.
2. MCP creates a checkout session with status `waiting_store_selection`.
3. MCP returns an `action_url` for store selection.
4. Shopper opens the link and selects a convenience store.
5. Webless stores the selected store data on the checkout session.
6. Webless revalidates products, price, stock, shipping fee, recipient data,
   and store data.
7. Webless creates the formal order.
8. Webless redirects the shopper to the payment provider.
9. Payment callback updates the order payment state.
10. Shopper returns to the SlimWeb completion page.

The shopper should not need to visit the normal recipient form when the MCP has
already supplied valid buyer and recipient data. The store-selection page is a
focused external action that completes the missing logistics data.

### Convenience Store Pickup With Pickup Payment

For pickup payment, there is no online payment provider step. If the shopper
can reuse the previous store and recipient data, the MCP can create the order
directly after explicit chat confirmation.

Example: "Buy two bags of the same cat food as last time."

1. MCP reads the customer's recent order history.
2. MCP extracts the previous product, pickup store, recipient, phone, and
   pickup-payment method.
3. MCP verifies the current product id, stock, price, buy limits, shipping fee,
   and quantity requested by the shopper.
4. MCP shows a confirmation preview with product, quantity, pickup store,
   recipient, payment method, and total.
5. Shopper explicitly confirms in chat.
6. Webless creates the formal order with the reused pickup store and pickup
   payment method.

If the previous store cannot be reused, store data is missing, or the shopper
asks for a different store, the flow must fall back to the checkout-session
`action_url` store-selection flow.

### Status and Follow-Up

The MCP should not run background polling after returning an action URL. The
external page and provider callbacks write state into Webless. The AI client
checks progress only when the shopper asks or when the conversation continues,
using a future status tool such as:

```text
client_checkout_status({ checkout_token })
```

This status tool should report whether the checkout session is waiting for
store selection, waiting for payment, completed, expired, or failed.

### Safety Requirements

- Do not create a formal order before required logistics and payment inputs are
  complete.
- Do not trust prices, totals, store data, member id, or product ids from the AI
  client without server-side validation.
- Recalculate product price, stock, shipping fee, and total immediately before
  formal order creation.
- Require explicit chat confirmation before creating any order that does not
  need an external user action.
- Use provider callbacks as payment/logistics truth.
- Expire checkout tokens and prevent completed tokens from being reused.
- Keep member/order data scoped to the signed-in site member.

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
