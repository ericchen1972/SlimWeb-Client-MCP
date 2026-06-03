# Site-Code Client MCP Design

## Purpose

SlimWeb Client MCP is a public, consumer-side MCP endpoint for one Webless site.
Merchants copy this URL from Webless basic settings and share it with customers
or MCP-capable AI clients.

## URL Contract

The canonical URL format is:

```text
https://<slimweb-client-mcp-host>/sites/{callback_code}/mcp
```

`callback_code` is the existing Webless `sites.callback_code` value, such as
`swcb_zog0l7zlyp3lwmlc`. The request host must not determine the site. Custom
storefront domains do not affect MCP routing.

## Login And Member Provisioning

Google login uses the same identity-token verification shape as SlimWeb-MCP.
After Google verification, the Client MCP resolves the site by
`sites.callback_code` and provisions a site-scoped member:

1. Find `members` by `site_id + google_id`.
2. If missing, find by `site_id + email` and attach `google_id`.
3. If still missing, create an active member with `site_id`, `email`, `name`,
   `google_id`, and `last_login_at`.

The session is scoped to `site_id`, `callback_code`, and `member_id`.

## Webless Admin UI

Webless basic settings exposes a read-only "Consumer MCP URL" field with a copy
button. The URL is built from `SLIMWEB_CLIENT_MCP_BASE_URL` and the site's
`callback_code`.

## SlimWeb-MCP And Skill Awareness

SlimWeb-MCP should surface the consumer MCP URL as site information. The
SlimWeb-MCP Skill must explain that the URL is a customer-facing MCP endpoint,
not a payment/logistics callback and not an admin MCP.
