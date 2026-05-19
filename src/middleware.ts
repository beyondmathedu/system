import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return response;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refresh session from cookies without a round-trip to Auth (getUser hits the server every time).
  // Server Components still call getUser() / profile where verification matters.
  const { error: sessionError } = await supabase.auth.getSession();
  // Stale cookies (e.g. project URL/key changed, JWT secret rotated, or revoked session) → clear so user can log in again.
  if (
    sessionError &&
    (sessionError.code === "refresh_token_not_found" ||
      /invalid refresh token|refresh token not found/i.test(sessionError.message ?? ""))
  ) {
    await supabase.auth.signOut();
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login|reset-password|auth/confirm|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
