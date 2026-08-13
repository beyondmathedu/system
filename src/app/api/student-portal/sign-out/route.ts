import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

/** Sign out and return to login (e.g. inactive student blocked from portal). */
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  const loginUrl = new URL("/login", request.url);
  const error = request.nextUrl.searchParams.get("error");
  const reactivate = request.nextUrl.searchParams.get("reactivate");
  if (error) loginUrl.searchParams.set("error", error);
  if (reactivate) loginUrl.searchParams.set("reactivate", reactivate);
  return NextResponse.redirect(loginUrl);
}
