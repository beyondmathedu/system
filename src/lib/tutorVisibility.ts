import { supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  fetchInactiveTutorNames,
  fetchTutorVisibility,
  isInactiveTutorName,
  type TutorVisibility,
} from "@/lib/tutorVisibilityCore";

export { TUTOR_STATUS_INACTIVE } from "@/lib/tutorConstants";
export { isInactiveTutorName, type TutorVisibility };

export async function loadTutorVisibility(): Promise<TutorVisibility> {
  return fetchTutorVisibility(supabaseBrowser);
}

export async function loadInactiveTutorNames(): Promise<Set<string>> {
  return fetchInactiveTutorNames(supabaseBrowser);
}
