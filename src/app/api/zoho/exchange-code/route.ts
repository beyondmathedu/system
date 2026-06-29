import { NextResponse } from "next/server";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const code = (url.searchParams.get("code") ?? "").trim();
  if (!code) {
    return NextResponse.json(
      { ok: false, error: "missing_code", message: "請提供 ?code=..." },
      { status: 400 },
    );
  }

  const clientId = process.env.ZOHO_CLIENT_ID ?? "";
  const clientSecret = process.env.ZOHO_CLIENT_SECRET ?? "";
  const redirectUri = process.env.ZOHO_REDIRECT_URI ?? "";
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { ok: false, error: "missing_env", message: "缺少 ZOHO_* 環境變數" },
      { status: 500 },
    );
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const resp = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const text = await resp.text();
  type ZohoTokenResponse = {
    ok?: boolean;
    error?: string;
    raw?: string;
    access_token?: string;
    refresh_token?: string;
    api_domain?: string;
    token_type?: string;
    expires_in?: number | null;
  };
  let parsed: ZohoTokenResponse | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  if (!resp.ok || parsed?.error) {
    return NextResponse.json(
      {
        ok: false,
        status: resp.status,
        zoho: parsed,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    access_token: parsed?.access_token ?? "",
    refresh_token: parsed?.refresh_token ?? "",
    api_domain: parsed?.api_domain ?? "",
    token_type: parsed?.token_type ?? "",
    expires_in: parsed?.expires_in ?? null,
  });
}
