import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  fetchInactiveTutorNames,
  fetchTutorVisibility,
  type TutorVisibility,
} from "@/lib/tutorVisibilityCore";

export async function loadTutorVisibility(): Promise<TutorVisibility> {
  const supabase = await createSupabaseServerClient();
  return fetchTutorVisibility(supabase);
}

export async function loadInactiveTutorNames(): Promise<Set<string>> {
  const supabase = await createSupabaseServerClient();
  return fetchInactiveTutorNames(supabase);
}
