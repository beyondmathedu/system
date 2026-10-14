import { supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  fetchInactiveTutorFromByName,
  fetchInactiveTutorNames,
  fetchTutorVisibility,
  isInactiveTutorName,
  shouldBlankInactiveTutorForDate,
  type TutorVisibility,
} from "@/lib/tutorVisibilityCore";

export { TUTOR_STATUS_INACTIVE } from "@/lib/tutorConstants";
export { isInactiveTutorName, shouldBlankInactiveTutorForDate, type TutorVisibility };

export async function loadTutorVisibility(): Promise<TutorVisibility> {
  return fetchTutorVisibility(supabaseBrowser);
}

export async function loadInactiveTutorNames(): Promise<Set<string>> {
  return fetchInactiveTutorNames(supabaseBrowser);
}

export async function loadInactiveTutorFromByName(): Promise<Map<string, string>> {
  return fetchInactiveTutorFromByName(supabaseBrowser);
}
