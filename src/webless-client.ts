export interface CatalogSearchInput {
  query: string;
  limit?: number;
  minPrice?: number;
  maxPrice?: number;
  freshness?: "latest";
  popularity?: "popular";
  priceOrder?: "asc" | "desc";
}

export interface ProductDetailInput {
  productId: string;
}

export interface ProductVerifyInput {
  productId: string;
  quantity?: number;
}

export interface OrderListInput {
  status?: "all" | "pending" | "completed";
  limit?: number;
}

export interface OrderPreviewInput {
  items: Array<{
    productId: number;
    quantity: number;
  }>;
  buyerName: string;
  buyerPhone: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
}

export interface CheckoutStartInput extends OrderPreviewInput {
  paymentMethod: "online" | "pickup_pay" | "cod";
  logisticsMethod: "home_delivery" | "cvs_pickup";
  reusePreviousStore?: boolean;
  confirmBeforeCreate?: boolean;
}

export interface CheckoutStatusInput {
  checkoutToken: string;
}

export type WeblessJson = Record<string, unknown>;

export class WeblessRequestError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly url: string;

  constructor(status: number, message: string, body: unknown, url: URL) {
    super(`Webless request failed: ${status} ${message}`);
    this.name = "WeblessRequestError";
    this.status = status;
    this.body = body;
    this.url = url.toString();
  }
}

export interface WeblessClientOptions {
  baseUrl: string;
  siteKey?: string;
  memberId?: number;
  fetchImpl?: (input: Request) => Promise<Response>;
}

export class WeblessClient {
  private readonly baseUrl: string;
  private readonly siteKey?: string;
  private readonly memberId?: number;
  private readonly fetchImpl: (input: Request) => Promise<Response>;

  constructor(options: WeblessClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.siteKey = options.siteKey;
    this.memberId = options.memberId;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getCatalogOverview(): Promise<WeblessJson> {
    const url = this.url("/api/storefront/catalog/overview");
    this.appendSite(url);

    return this.getJson(url);
  }

  searchCatalog(input: CatalogSearchInput): Promise<WeblessJson> {
    const url = this.url("/api/storefront/catalog/search");
    url.searchParams.set("q", input.query);
    url.searchParams.set("limit", String(input.limit ?? 2));

    if (input.minPrice !== undefined) {
      url.searchParams.set("min_price", String(input.minPrice));
    }

    if (input.maxPrice !== undefined) {
      url.searchParams.set("max_price", String(input.maxPrice));
    }

    if (input.freshness !== undefined) {
      url.searchParams.set("freshness", input.freshness);
    }

    if (input.popularity !== undefined) {
      url.searchParams.set("popularity", input.popularity);
    }

    if (input.priceOrder !== undefined) {
      url.searchParams.set("price_order", input.priceOrder);
    }

    this.appendSite(url);

    return this.getJson(url);
  }

  getProductDetail(input: ProductDetailInput): Promise<WeblessJson> {
    const url = this.url(
      `/api/storefront/products/${encodeURIComponent(input.productId)}`,
    );
    this.appendSite(url);

    return this.getJson(url);
  }

  verifyProduct(input: ProductVerifyInput): Promise<WeblessJson> {
    const url = this.url(
      `/api/storefront/products/${encodeURIComponent(input.productId)}/verify`,
    );
    this.appendSite(url);

    if (input.quantity !== undefined) {
      url.searchParams.set("quantity", String(input.quantity));
    }

    return this.getJson(url);
  }

  getOrderList(input: OrderListInput = {}): Promise<WeblessJson> {
    const url = this.url("/api/storefront/orders");
    this.appendSite(url);

    if (this.memberId !== undefined) {
      url.searchParams.set("member_id", String(this.memberId));
    }

    if (input.status !== undefined) {
      url.searchParams.set("status", input.status);
    }

    if (input.limit !== undefined) {
      url.searchParams.set("limit", String(input.limit));
    }

    return this.getJson(url);
  }

  getCustomerContext(): Promise<WeblessJson> {
    const url = this.url("/api/storefront/customer/context");
    this.appendSite(url);

    if (this.memberId !== undefined) {
      url.searchParams.set("member_id", String(this.memberId));
    }

    return this.getJson(url);
  }

  getOrderPreview(input: OrderPreviewInput): Promise<WeblessJson> {
    const url = this.url("/api/storefront/order-preview");
    this.appendSite(url);

    if (this.memberId !== undefined) {
      url.searchParams.set("member_id", String(this.memberId));
    }

    return this.postJson(url, {
      items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
      })),
      buyer_name: input.buyerName,
      buyer_phone: input.buyerPhone,
      recipient_name: input.recipientName,
      recipient_phone: input.recipientPhone,
      recipient_address: input.recipientAddress,
    });
  }

  startCheckout(input: CheckoutStartInput): Promise<WeblessJson> {
    const url = this.url("/api/storefront/checkouts");
    this.appendSite(url);

    if (this.memberId !== undefined) {
      url.searchParams.set("member_id", String(this.memberId));
    }

    return this.postJson(url, {
      items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
      })),
      buyer_name: input.buyerName,
      buyer_phone: input.buyerPhone,
      recipient_name: input.recipientName,
      recipient_phone: input.recipientPhone,
      recipient_address: input.recipientAddress,
      payment_method: input.paymentMethod,
      logistics_method: input.logisticsMethod,
      reuse_previous_store: input.reusePreviousStore ?? false,
      confirm_before_create: input.confirmBeforeCreate ?? false,
    });
  }

  getCheckoutStatus(input: CheckoutStatusInput): Promise<WeblessJson> {
    const url = this.url(
      `/api/storefront/checkouts/${encodeURIComponent(input.checkoutToken)}`,
    );
    this.appendSite(url);

    if (this.memberId !== undefined) {
      url.searchParams.set("member_id", String(this.memberId));
    }

    return this.getJson(url);
  }

  private url(path: string): URL {
    return new URL(path, this.baseUrl);
  }

  private appendSite(url: URL): void {
    if (this.siteKey) {
      url.searchParams.set("site", this.siteKey);
    }
  }

  private async getJson(url: URL): Promise<WeblessJson> {
    const response = await this.fetchImpl(
      new Request(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }),
    );

    const body = await readJsonBody(response);

    if (!response.ok) {
      const message = extractMessage(body) ?? response.statusText;
      throw new WeblessRequestError(response.status, message, body, url);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Webless request failed: response body must be a JSON object");
    }

    return body as WeblessJson;
  }

  private async postJson(url: URL, payload: unknown): Promise<WeblessJson> {
    const response = await this.fetchImpl(
      new Request(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
    );

    const body = await readJsonBody(response);

    if (!response.ok) {
      const message = extractMessage(body) ?? response.statusText;
      throw new WeblessRequestError(response.status, message, body, url);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Webless request failed: response body must be a JSON object");
    }

    return body as WeblessJson;
  }
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(body: unknown): string | undefined {
  if (
    body &&
    typeof body === "object" &&
    "message" in body &&
    typeof body.message === "string"
  ) {
    return body.message;
  }

  return undefined;
}
