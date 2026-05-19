"use client";

/**
 * Browser Supabase client (cookie session, works with Next.js proxy + SSR auth).
 * Server Components / Route Handlers should use `createSupabaseServerClient()` instead.
 */
export { supabaseBrowser as supabase } from "./supabaseBrowser";
