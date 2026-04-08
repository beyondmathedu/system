import { supabase } from "@/lib/supabase";

/** 對應 Tutor 頁 Inactive；此狀態的導師不應在其他頁面顯示 */
export const TUTOR_STATUS_INACTIVE = "已解僱";

const TUTOR_STATUS_ACTIVE = "工作中";
const TUTOR_STATUS_OCCASIONAL = "放假中";

/** Active(0) → Occasional(1) → 其他非 Inactive(2) */
function tutorStatusSelectRank(status: string): number {
  const s = status.trim();
  if (s === TUTOR_STATUS_ACTIVE) return 0;
  if (s === TUTOR_STATUS_OCCASIONAL) return 1;
  return 2;
}

export type TutorVisibility = {
  inactiveNames: Set<string>;
  /**
   * 工作中／放假中 導師，供下拉選單：先 Active，再 Occasional，同狀態內依 A–Z（en）排序；已解僱不包含。
   */
  activeSelectNames: string[];
};

/**
 * 讀取 tutors 並區分「已解僱」與可選導師名稱（name / name_zh / name_en 皆納入 inactive 比對）。
 */
export async function loadTutorVisibility(): Promise<TutorVisibility> {
  const { data, error } = await supabase.from("tutors").select("name, name_zh, name_en, status, id");

  if (error || !data?.length) {
    return { inactiveNames: new Set(), activeSelectNames: [] };
  }

  const inactiveNames = new Set<string>();
  const activeEntries: { status: string; label: string }[] = [];

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
    // 顯示名稱：中文優先（與 /tutor、月度導師導航一致）
    const label = z || n || en;
    if (!label) continue;
    activeEntries.push({ status: st, label });
  }

  activeEntries.sort((a, b) => {
    const ra = tutorStatusSelectRank(a.status);
    const rb = tutorStatusSelectRank(b.status);
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label, "en", { sensitivity: "base", numeric: true });
  });

  const seen = new Set<string>();
  const activeSelectNames: string[] = [];
  for (const e of activeEntries) {
    if (seen.has(e.label)) continue;
    seen.add(e.label);
    activeSelectNames.push(e.label);
  }

  return { inactiveNames, activeSelectNames };
}

export function isInactiveTutorName(inactiveNames: Set<string>, displayName: string): boolean {
  const t = displayName.trim();
  if (!t || t === "—" || t === "待定") return false;
  return inactiveNames.has(t);
}

/**
 * 只載入「已解僱」導師的 name／name_zh／name_en（供房間課表遮罩）。
 * 比 loadTutorVisibility 少傳回 active 列，網路與記憶體皆 O(已解僱人數) 而非 O(全體導師)。
 */
export async function loadInactiveTutorNames(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("tutors")
    .select("name, name_zh, name_en")
    .eq("status", TUTOR_STATUS_INACTIVE);

  if (error) return new Set<string>();
  const rows = data ?? [];
  if (rows.length === 0) return new Set<string>();

  const out = new Set<string>();
  for (const row of rows) {
    const r = row as { name?: string | null; name_zh?: string | null; name_en?: string | null };
    for (const v of [r.name, r.name_zh, r.name_en]) {
      const t = String(v ?? "").trim();
      if (t) out.add(t);
    }
  }
  return out;
}
