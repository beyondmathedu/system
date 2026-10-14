import type { SupabaseClient } from "@supabase/supabase-js";
import { hkTodayIso } from "@/lib/examDateVisibility";
import {
  isSharedIpadTutorDisplayName,
  TUTOR_STATUS_ACTIVE,
  TUTOR_STATUS_INACTIVE,
  TUTOR_STATUS_OCCASIONAL,
} from "@/lib/tutorConstants";

function tutorStatusSelectRank(status: string): number {
  const s = status.trim();
  if (s === TUTOR_STATUS_ACTIVE) return 0;
  if (s === TUTOR_STATUS_OCCASIONAL) return 1;
  return 2;
}

function isIsoDate(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

function isMissingInactiveFromDateColumnError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("inactive_from_date") && (m.includes("does not exist") || m.includes("schema cache"));
}

export type TutorVisibility = {
  inactiveNames: Set<string>;
  /** Inactive tutor display-name aliases → leave-start YYYY-MM-DD (may be ""). */
  inactiveFromByName: Map<string, string>;
  activeSelectNames: string[];
  activeAliasToNickname: Map<string, string>;
};

function emptyVisibility(): TutorVisibility {
  return {
    inactiveNames: new Set(),
    inactiveFromByName: new Map(),
    activeSelectNames: [],
    activeAliasToNickname: new Map(),
  };
}

export async function fetchTutorVisibility(
  supabase: SupabaseClient,
): Promise<TutorVisibility> {
  let { data, error } = await supabase
    .from("tutors")
    .select("name, name_zh, name_en, status, id, inactive_from_date");
  if (error && isMissingInactiveFromDateColumnError(error.message)) {
    const retry = await supabase.from("tutors").select("name, name_zh, name_en, status, id");
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (error || !data?.length) return emptyVisibility();

  const inactiveNames = new Set<string>();
  const inactiveFromByName = new Map<string, string>();
  const activeEntries: { status: string; nickname: string }[] = [];
  const activeAliasToNickname = new Map<string, string>();

  for (const row of data) {
    const st = String((row as { status?: string }).status ?? "").trim();
    const n = String((row as { name?: string }).name ?? "").trim();
    const z = String((row as { name_zh?: string }).name_zh ?? "").trim();
    const en = String((row as { name_en?: string }).name_en ?? "").trim();
    const leaveRaw = String((row as { inactive_from_date?: string | null }).inactive_from_date ?? "")
      .trim()
      .slice(0, 10);
    const leaveIso = isIsoDate(leaveRaw) ? leaveRaw : "";
    if (st === TUTOR_STATUS_INACTIVE) {
      for (const label of [n, z, en]) {
        if (!label) continue;
        inactiveNames.add(label);
        inactiveFromByName.set(label, leaveIso);
      }
      continue;
    }
    const nickname = n || z || en;
    if (!nickname) continue;
    if ([n, z, en, nickname].some((label) => isSharedIpadTutorDisplayName(label))) continue;
    activeEntries.push({ status: st, nickname });
    for (const alias of [n, z, en]) {
      const t = alias.trim();
      if (t) activeAliasToNickname.set(t, nickname);
    }
  }

  activeEntries.sort((a, b) => {
    const ra = tutorStatusSelectRank(a.status);
    const rb = tutorStatusSelectRank(b.status);
    if (ra !== rb) return ra - rb;
    return a.nickname.localeCompare(b.nickname, "en", { sensitivity: "base", numeric: true });
  });

  const seen = new Set<string>();
  const activeSelectNames: string[] = [];
  for (const e of activeEntries) {
    if (seen.has(e.nickname)) continue;
    seen.add(e.nickname);
    activeSelectNames.push(e.nickname);
  }

  return { inactiveNames, inactiveFromByName, activeSelectNames, activeAliasToNickname };
}

export async function fetchInactiveTutorNames(supabase: SupabaseClient): Promise<Set<string>> {
  const vis = await fetchTutorVisibility(supabase);
  return vis.inactiveNames;
}

export async function fetchInactiveTutorFromByName(
  supabase: SupabaseClient,
): Promise<Map<string, string>> {
  const vis = await fetchTutorVisibility(supabase);
  return vis.inactiveFromByName;
}

export function isInactiveTutorName(inactiveNames: Set<string>, displayName: string): boolean {
  const t = displayName.trim();
  if (!t || t === "—" || t === "待定") return false;
  return inactiveNames.has(t);
}

/**
 * Blank inactive tutors from leave-start date onward (inclusive).
 * If leave date missing: keep past/today name, blank only strictly future (today HK).
 */
export function shouldBlankInactiveTutorForDate(
  inactiveFromByName: ReadonlyMap<string, string> | ReadonlySet<string>,
  displayName: string,
  dateIso: string,
  todayIso = hkTodayIso(),
): boolean {
  const t = displayName.trim();
  if (!t || t === "—" || t === "待定") return false;
  const d = String(dateIso ?? "").trim();
  if (!isIsoDate(d)) return false;

  if (inactiveFromByName instanceof Set) {
    if (!inactiveFromByName.has(t)) return false;
    return d > todayIso;
  }

  const leaveMap = inactiveFromByName as ReadonlyMap<string, string>;
  if (!leaveMap.has(t)) return false;
  const leave = String(leaveMap.get(t) ?? "").trim();
  if (isIsoDate(leave)) return d >= leave;
  return d > todayIso;
}
