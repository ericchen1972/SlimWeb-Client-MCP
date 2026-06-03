export const PRODUCT_LIST_WIDGET_URI = "ui://widget/product-list.html";
export const MCP_APP_HTML_MIME_TYPE = "text/html;profile=mcp-app";
export const PRODUCT_LIST_WIDGET_DOMAIN = "https://slimweb-client-mcp-aakwcbp2ca-de.a.run.app";

const PRODUCT_LIST_WIDGET_HTML = `
<div id="root" class="slimweb-products" aria-live="polite">
  <div class="empty">Loading products...</div>
</div>
<style>
  :root {
    color-scheme: light dark;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  body {
    margin: 0;
    background: transparent;
    color: CanvasText;
  }
  .slimweb-products {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    padding: 12px;
    box-sizing: border-box;
  }
  .product-card {
    border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, Canvas 94%, CanvasText 6%);
    overflow: hidden;
    min-width: 0;
  }
  .product-card img {
    display: block;
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    background: color-mix(in srgb, CanvasText 8%, transparent);
  }
  .product-body {
    padding: 10px;
  }
  .product-title {
    margin: 0 0 8px;
    font-size: 13px;
    line-height: 1.35;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .product-price {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 700;
  }
  .product-link {
    display: inline-flex;
    align-items: center;
    min-height: 30px;
    color: inherit;
    font-size: 12px;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .empty {
    grid-column: 1 / -1;
    padding: 16px;
    font-size: 13px;
    color: color-mix(in srgb, CanvasText 62%, transparent);
  }
  .diagnostics {
    grid-column: 1 / -1;
    margin-top: -6px;
    padding: 12px 16px;
    border: 1px dashed color-mix(in srgb, CanvasText 22%, transparent);
    border-radius: 8px;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    font-size: 12px;
    line-height: 1.45;
  }
  .diagnostics-title {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 700;
    color: CanvasText;
  }
  .diagnostics-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    border-top: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    padding-top: 5px;
    margin-top: 5px;
  }
  .diagnostics-row span:last-child {
    overflow-wrap: anywhere;
    text-align: right;
  }
</style>
<script>
  const root = document.getElementById("root");
  let rendered = false;
  let fallbackStarted = false;
  let latestToolInput = null;
  const lastEvents = [];

  function text(value, fallback = "") {
    return typeof value === "string" && value.trim() ? value : fallback;
  }

  function price(item) {
    return text(item?.price?.formatted) || text(item?.regular_price?.formatted);
  }

  function proxyImageUrl(imageUrl) {
    try {
      const url = new URL(imageUrl);

      if (!["http:", "https:"].includes(url.protocol)) {
        return imageUrl;
      }

      return "${PRODUCT_LIST_WIDGET_DOMAIN}/image-proxy?url=" + encodeURIComponent(url.toString());
    } catch {
      return imageUrl;
    }
  }

  function objectValue(value) {
    return value && typeof value === "object" ? value : null;
  }

  function enqueueObjectValues(queue, candidate) {
    for (const value of Object.values(candidate)) {
      if (objectValue(value)) {
        queue.push(value);
      }
    }
  }

  function productPayload(value) {
    const seen = new Set();
    const queue = [value];

    while (queue.length > 0) {
      const candidate = objectValue(queue.shift());
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);

      if (Array.isArray(candidate.items)) {
        return candidate;
      }

      if (objectValue(candidate.product)) {
        return { ...candidate, items: [candidate.product] };
      }

      queue.push(
        candidate.structuredContent,
        candidate.toolOutput,
        candidate.toolResponse,
        candidate.toolResponseMetadata,
        candidate.call_tool_result,
        candidate.mcp_tool_result,
        candidate.result,
        candidate.params,
        candidate.globals,
      );
      enqueueObjectValues(queue, candidate);
    }

    return null;
  }

  function toolInputPayload(value) {
    const seen = new Set();
    const queue = [value];

    while (queue.length > 0) {
      const candidate = objectValue(queue.shift());
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);

      if (typeof candidate.query === "string" && candidate.query.trim()) {
        return candidate;
      }

      queue.push(
        candidate.toolInput,
        candidate.input,
        candidate.arguments,
        candidate.params,
        candidate.globals,
      );
      enqueueObjectValues(queue, candidate);
    }

    return null;
  }

  function readOpenAiPayload() {
    return productPayload({
      toolOutput: window.openai?.toolOutput,
      toolResponseMetadata: window.openai?.toolResponseMetadata,
    });
  }

  function readOpenAiInput() {
    return toolInputPayload({
      toolInput: window.openai?.toolInput,
      toolResponseMetadata: window.openai?.toolResponseMetadata,
    });
  }

  function rememberEvent(name, detail) {
    const keys = objectValue(detail) ? Object.keys(detail).slice(0, 8).join(",") : typeof detail;
    lastEvents.push(keys ? name + "(" + keys + ")" : name);
    if (lastEvents.length > 6) lastEvents.shift();
  }

  function yesNo(value) {
    return value ? "yes" : "no";
  }

  function keysOf(value) {
    return objectValue(value) ? Object.keys(value).slice(0, 10).join(",") || "object-no-keys" : typeof value;
  }

  function diagnosticsHtml(note = "") {
    const openai = objectValue(window.openai);
    const rows = [
      ["window.openai", yesNo(openai)],
      ["toolInput", yesNo(window.openai?.toolInput)],
      ["toolOutput", yesNo(window.openai?.toolOutput)],
      ["toolOutputKeys", keysOf(window.openai?.toolOutput)],
      ["toolResponseMetadata", yesNo(window.openai?.toolResponseMetadata)],
      ["toolResponseMetadataKeys", keysOf(window.openai?.toolResponseMetadata)],
      ["callTool", typeof window.openai?.callTool === "function" ? "yes" : "no"],
      ["latestToolInput", yesNo(latestToolInput)],
      ["latestToolInputKeys", keysOf(latestToolInput)],
      ["fallbackStarted", yesNo(fallbackStarted)],
      ["lastEvents", lastEvents.length ? lastEvents.join(" | ") : "none"],
    ];

    return '<div class="diagnostics" data-slimweb-bridge-diagnostics="true">' +
      '<p class="diagnostics-title">Bridge diagnostics</p>' +
      (note ? '<div class="diagnostics-row"><span>note</span><span>' + note + '</span></div>' : '') +
      rows.map(([label, value]) =>
        '<div class="diagnostics-row"><span>' + label + '</span><span>' + value + '</span></div>'
      ).join("") +
      '</div>';
  }

  function renderWaiting() {
    root.innerHTML = '<div class="empty">Waiting for product data...</div>' + diagnosticsHtml();
    window.openai?.notifyIntrinsicHeight?.();
  }

  function rememberToolInput(payload) {
    latestToolInput = toolInputPayload(payload) || latestToolInput;
  }

  async function loadProductsFromWidget() {
    if (rendered || fallbackStarted || !latestToolInput || !window.openai?.callTool) return;

    fallbackStarted = true;
    root.innerHTML = '<div class="empty">Loading product cards...</div>' + diagnosticsHtml("widget fallback callTool started");
    window.openai.notifyIntrinsicHeight?.();

    try {
      const result = await window.openai.callTool("client_catalog_search", latestToolInput);
      rememberEvent("callTool:result", result);
      render(result);
    } catch {
      root.innerHTML = '<div class="empty">Product data was returned, but the widget bridge did not deliver it.</div>' +
        diagnosticsHtml("callTool failed or was blocked");
      window.openai.notifyIntrinsicHeight?.();
    }
  }

  function render(payload) {
    const normalizedPayload = productPayload(payload);
    if (!normalizedPayload) {
      renderWaiting();
      return;
    }

    rendered = true;
    const items = normalizedPayload.items.slice(0, 5);
    if (items.length === 0) {
      root.innerHTML = '<div class="empty">No matching products found.</div>';
      window.openai?.notifyIntrinsicHeight?.();
      return;
    }

    root.replaceChildren(...items.map((item) => {
      const card = document.createElement("article");
      card.className = "product-card";

      const imageUrl = text(item?.image_url);
      if (imageUrl) {
        const img = document.createElement("img");
        img.src = proxyImageUrl(imageUrl);
        img.alt = text(item?.name, "Product image");
        img.loading = "lazy";
        card.append(img);
      }

      const body = document.createElement("div");
      body.className = "product-body";

      const title = document.createElement("h3");
      title.className = "product-title";
      title.textContent = text(item?.name, "Product");
      body.append(title);

      const priceText = price(item);
      if (priceText) {
        const priceEl = document.createElement("p");
        priceEl.className = "product-price";
        priceEl.textContent = priceText;
        body.append(priceEl);
      }

      const href = text(item?.product_url);
      if (href) {
        const link = document.createElement("a");
        link.className = "product-link";
        link.href = href;
        link.textContent = "View product";
        link.addEventListener("click", (event) => {
          if (window.openai?.openExternal) {
            event.preventDefault();
            window.openai.openExternal({ href });
          }
        });
        body.append(link);
      }

      card.append(body);
      return card;
    }));

    window.openai?.notifyIntrinsicHeight?.();
  }

  rememberToolInput(readOpenAiInput());
  rememberEvent("initial", window.openai);
  render(readOpenAiPayload());

  let pollCount = 0;
  const pollForGlobals = window.setInterval(() => {
    if (rendered || pollCount >= 20) {
      window.clearInterval(pollForGlobals);
      loadProductsFromWidget();
      return;
    }

    pollCount += 1;
    rememberToolInput(readOpenAiInput());
    render(readOpenAiPayload());
  }, 100);

  window.addEventListener("openai:set_globals", (event) => {
    rememberEvent("openai:set_globals", event.detail);
    rememberToolInput(event.detail);
    render(event.detail);
    window.setTimeout(loadProductsFromWidget, 250);
  }, { passive: true });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    rememberEvent(message.method || "message", message.params);
    if (message.method === "ui/notifications/tool-input") {
      rememberToolInput(message.params);
      window.setTimeout(loadProductsFromWidget, 250);
      return;
    }
    if (message.method !== "ui/notifications/tool-result") return;
    render(message.params);
  }, { passive: true });
</script>
`.trim();

export function productListWidgetResource() {
  return {
    uri: PRODUCT_LIST_WIDGET_URI,
    name: "SlimWeb product list",
    description: "Displays SlimWeb storefront product search results as image cards.",
    mimeType: MCP_APP_HTML_MIME_TYPE,
  };
}

export function productListWidgetContents() {
  const csp = {
    connectDomains: [
      "https://slimweb.tw",
      "https://slimweb-client-mcp-aakwcbp2ca-de.a.run.app",
    ],
    resourceDomains: [
      PRODUCT_LIST_WIDGET_DOMAIN,
      "https://slimweb.tw",
      "https://i1.momoshop.com.tw",
      "https://i2.momoshop.com.tw",
      "https://i3.momoshop.com.tw",
      "https://i4.momoshop.com.tw",
      "https://img1.momoshop.com.tw",
      "https://img2.momoshop.com.tw",
      "https://img3.momoshop.com.tw",
    ],
  };

  return {
    uri: PRODUCT_LIST_WIDGET_URI,
    mimeType: MCP_APP_HTML_MIME_TYPE,
    text: PRODUCT_LIST_WIDGET_HTML,
    _meta: {
      ui: {
        prefersBorder: true,
        csp,
        domain: PRODUCT_LIST_WIDGET_DOMAIN,
      },
      "openai/widgetDescription": "SlimWeb storefront product search results with images, prices, and product links.",
      "openai/widgetPrefersBorder": true,
      "openai/widgetDomain": PRODUCT_LIST_WIDGET_DOMAIN,
      "openai/widgetCSP": {
        connect_domains: csp.connectDomains,
        resource_domains: csp.resourceDomains,
        redirect_domains: ["https://slimweb.tw"],
      },
    },
  };
}
