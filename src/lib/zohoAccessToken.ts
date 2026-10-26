/** Cached Zoho OAuth access token — avoids refreshing on every Sync batch. */

type CachedToken = {
  accessToken: string;
  /** Epoch ms when this cache entry should be discarded. */
  expiresAtMs: number;
};

let cached: CachedToken | null = null;
let inflight: Promise<string> | null = null;

type ZohoTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  status?: string;
};

function isRateLimitedTokenError(json: ZohoTokenResponse, status: number): boolean {
  const blob = `${json.error ?? ""} ${json.error_description ?? ""} ${json.status ?? ""}`.toLowerCase();
  return (
    status === 429 ||
    blob.includes("too many requests") ||
    blob.includes("access denied") ||
    blob.includes("rate limit")
  );
}

export function clearZohoAccessTokenCache(): void {
  cached = null;
}

/**
 * Refresh-token grant with process-local cache (~50 min for a 1h Zoho token).
 * Concurrent callers share one in-flight refresh.
 */
export async function getZohoAccessTokenCached(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAtMs > now + 30_000) {
    return cached.accessToken;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const clientId = process.env.ZOHO_CLIENT_ID ?? "";
    const clientSecret = process.env.ZOHO_CLIENT_SECRET ?? "";
    const refreshToken = process.env.ZOHO_REFRESH_TOKEN ?? "";
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("Missing ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN");
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });
    const resp = await fetch("https://accounts.zoho.com/oauth/v2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    const json = (await resp.json()) as ZohoTokenResponse;
    if (!resp.ok || json.error || !json.access_token) {
      if (isRateLimitedTokenError(json, resp.status)) {
        throw new Error(
          "ZOHO_TOKEN_RATE_LIMITED: Zoho 暫時拒絕換取 token（請求太密）。已繳未改動。請等 30–60 分鐘後再按 Sync，會由斷點繼續。",
        );
      }
      throw new Error(`Zoho token error: ${JSON.stringify(json)}`);
    }
    const expiresInSec = Number(json.expires_in);
    const ttlMs =
      Number.isFinite(expiresInSec) && expiresInSec > 120
        ? Math.floor(expiresInSec * 1000 * 0.85)
        : 50 * 60 * 1000;
    cached = {
      accessToken: String(json.access_token),
      expiresAtMs: Date.now() + ttlMs,
    };
    return cached.accessToken;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
