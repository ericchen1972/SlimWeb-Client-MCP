# Client MCP Initial Design

## Purpose

This repository implements a separate MCP service for Webless consumer-side
operations. It is not the existing site/admin/theme MCP, and it is not the
docs-only skill repository.

## Initial Scope

The first version provides a minimal, testable TypeScript MCP server with
consumer-facing tool boundaries:

- `client_catalog_search`: search storefront catalog data.
- `client_product_detail`: retrieve a storefront product detail.
- `client_order_lookup`: retrieve a customer-visible order summary.

These tools call Webless HTTP endpoints through a small client wrapper. The
wrapper is intentionally endpoint-configurable so Webless route details can be
aligned later without changing MCP tool names.

## Boundaries

The service may expose customer-visible state, but it must not own provider
callback truth or merchant-only operations. Payment callbacks, logistics
callbacks, manual refund completion, provider refund requests, and admin order
state transitions stay in the Webless backend.

The service returns provider/runtime errors as structured MCP errors instead of
inventing business state locally.

## Architecture

The service has four units:

- `config`: reads environment variables and validates runtime settings.
- `webless-client`: performs HTTP requests against the configured Webless base
  URL.
- `tools`: defines the stable MCP tool registry and maps tool calls to Webless
  client methods.
- `server`: wires the MCP SDK transport to the tool registry.

## Testing

Unit tests cover config parsing, Webless HTTP request construction, and tool
registry behavior. The initial test suite uses Node's built-in test runner and
does not require a live Webless instance.
