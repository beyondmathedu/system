import type { SupabaseClient } from "@supabase/supabase-js";
import {
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

export type TutorVisibility = {
  inactiveNames: Set<string>;
  activeSelectNames: string[];
  activeAliasToNickname: Map<string, string>;
};

export async function fetchTutorVisibility(
  supabase: SupabaseClient,
): Promise<TutorVisibility> {
  const { data, error } = await supabase.from("tutors").select("name, name_zh, name_en, status, id");

  if (error || !data?.length) {
    return { inactiveNames: new Set(), activeSelectNames: [], activeAliasToNickname: new Map() };
  }

  const inactiveNames = new Set<string>();
  const activeEntries: { status: string; nickname: string }[] = [];
  const activeAliasToNickname = new Map<string, string>();

  for (const row of data) {
    const st = String((row as { status?: string }).status ?? "").trim();
    const n = String((row as { name?: string }).name ?? "").trim();
    const z = String((row as { name_zh?: string }).name_zh ?? "").trim();
    const en = String((row as { name_en?: string }).name_en ?? "").trim();
    if (st === TUTOR_STATUS_INACTIVE) {
      if (n) inactiveNames.add(n);
      if (z) inactiveNames.add(z);
      if (en) inactiveNames.add(en);
      continue;
    }
    const nickname = n || z || en;
    if (!nickname) continue;
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

  return { inactiveNames, activeSelectNames, activeAliasToNickname };
}

export async function fetchInactiveTutorNames(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("tutors")
    .select("name, name_zh, name_en")
    .eq("status", TUTOR_STATUS_INACTIVE);

  if (error) return new Set<string>();
  const out = new Set<string>();
  for (const row of data ?? []) {
    const r = row as { name?: string | null; name_zh?: string | null; name_en?: string | null };
    for (const v of [r.name, r.name_zh, r.name_en]) {
      const t = String(v ?? "").trim();
      if (t) out.add(t);
    }
  }
  return out;
}

export function isInactiveTutorName(inactiveNames: Set<string>, displayName: string): boolean {
  const t = displayName.trim();
  if (!t || t === "—" || t === "待定") return false;
  return inactiveNames.has(t);
}
