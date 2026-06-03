import type { GoogleProfile } from "./site-member-repository.js";

const DEFAULT_GOOGLE_CLIENT_ID =
  "27587628711-upin8ch154kqrl88k41978q660oc0pbg.apps.googleusercontent.com";

export interface GoogleVerifier {
  verify(credential: string): Promise<GoogleProfile>;
}

export class GoogleIdentityVerifier implements GoogleVerifier {
  private readonly clientId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { clientId?: string; fetchImpl?: typeof fetch } = {}) {
    this.clientId = options.clientId ?? DEFAULT_GOOGLE_CLIENT_ID;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async verify(credential: string): Promise<GoogleProfile> {
    if (!credential || typeof credential !== "string") {
      throw codedError("Google credential is required.", "INVALID_GOOGLE_CREDENTIAL");
    }

    const url = new URL("https://oauth2.googleapis.com/tokeninfo");
    url.searchParams.set("id_token", credential);

    const response = await this.fetchImpl(url);

    if (!response.ok) {
      throw codedError("Invalid Google credential.", "INVALID_GOOGLE_CREDENTIAL");
    }

    const payload = await response.json();

    if (payload.aud !== this.clientId || !payload.sub || !payload.email) {
      throw codedError("Invalid Google account.", "INVALID_GOOGLE_ACCOUNT");
    }

    return {
      sub: String(payload.sub),
      email: String(payload.email),
      name: String(payload.name ?? payload.email),
      picture: String(payload.picture ?? ""),
    };
  }
}

function codedError(message: string, code: string): Error {
  const error = new Error(message);
  Object.assign(error, { code });
  return error;
}
