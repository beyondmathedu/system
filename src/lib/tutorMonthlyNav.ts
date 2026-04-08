import { supabase } from "@/lib/supabase";

const STATUS_ORDER = ["工作中", "放假中", "已解僱"] as const;

export type TutorNavStatus = (typeof STATUS_ORDER)[number];

export type TutorNavEntry = {
  id: string;
  displayName: string;
  englishName: string;
  status: TutorNavStatus;
  /** 與課表 tutor 欄／覆寫顯示名稱比對 */
  matchNames: string[];
};

function rankStatus(s: string): number {
  const i = STATUS_ORDER.indexOf(s as TutorNavStatus);
  return i >= 0 ? i : 99;
}

function rowToEntry(row: {
  id: string;
  name?: string | null;
  name_zh?: string | null;
  name_en?: string | null;
  nickname_en?: string | null;
  status?: string | null;
}): TutorNavEntry {
  const statusRaw = String(row.status ?? "工作中").trim();
  const status = STATUS_ORDER.includes(statusRaw as TutorNavStatus)
    ? (statusRaw as TutorNavStatus)
    : "工作中";
  const n = String(row.name ?? "").trim();
  const z = String(row.name_zh ?? "").trim();
  const e = String(row.name_en ?? "").trim();
  const nick = String(row.nickname_en ?? "").trim();
  // 與 /tutor（teacher）頁一致：中文名稱優先顯示
  const displayName = z || n || e || nick || row.id;
  const englishName = e || n || z || nick || row.id;
  const matchNames = [...new Set([n, z, e, nick].filter(Boolean))];
  return { id: row.id, displayName, englishName, status, matchNames };
}

export async function fetchTutorsForMonthlyLessonNav(): Promise<TutorNavEntry[]> {
  const { data, error } = await supabase
    .from("tutors")
    .select("id, name, name_zh, name_en, nickname_en, status")
    .order("id");
  if (error || !data?.length) return [];
  const entries = data.map((row) => rowToEntry(row));
  entries.sort((a, b) => {
    const ra = rankStatus(a.status);
    const rb = rankStatus(b.status);
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });
  return entries;
}

export async function fetchTutorNavEntryById(id: string): Promise<TutorNavEntry | null> {
  const { data, error } = await supabase
    .from("tutors")
    .select("id, name, name_zh, name_en, nickname_en, status")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToEntry(data);
}

export const TUTOR_NAV_STATUS_LABEL: Record<TutorNavStatus, string> = {
  工作中: "Active",
  放假中: "Occasional",
  已解僱: "Inactive",
};

export function tutorNavStatusBadgeClass(status: TutorNavStatus): string {
  switch (status) {
    case "工作中":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "放假中":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "已解僱":
      return "border-slate-200 bg-slate-100 text-slate-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}
