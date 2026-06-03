export interface CatalogSearchInput {
  query: string;
  limit?: number;
}

export interface ProductDetailInput {
  productId: string;
}

export interface OrderSummaryInput {
  orderToken: string;
}

export type WeblessJson = unknown;

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

  searchCatalog(input: CatalogSearchInput): Promise<WeblessJson> {
    const url = this.url("/api/storefront/catalog/search");
    url.searchParams.set("q", input.query);

    if (input.limit !== undefined) {
      url.searchParams.set("limit", String(input.limit));
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

  getOrderSummary(input: OrderSummaryInput): Promise<WeblessJson> {
    const url = this.url(
      `/api/storefront/orders/${encodeURIComponent(input.orderToken)}`,
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
      throw new Error(`Webless request failed: ${response.status} ${message}`);
    }

    return body;
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
