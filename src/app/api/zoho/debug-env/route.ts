import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.ZOHO_CLIENT_ID ?? "";
  const clientSecret = process.env.ZOHO_CLIENT_SECRET ?? "";
  const redirectUri = process.env.ZOHO_REDIRECT_URI ?? "";

  return NextResponse.json({
    ok: true,
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    hasRedirectUri: Boolean(redirectUri),
    redirectUri,
    clientIdPreview: clientId ? `${clientId.slice(0, 8)}...` : "",
  });
}
