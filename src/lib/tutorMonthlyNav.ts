import { createSupabaseServerClient } from "@/lib/supabaseServer";

const STATUS_ORDER = ["工作中", "放假中", "已解僱"] as const;

export type TutorNavStatus = (typeof STATUS_ORDER)[number];

export type TutorNavEntry = {
  id: string;
  displayName: string;
  englishName: string;
  status: TutorNavStatus;
  /** Tutor 頁 MPF；欄位不存在時為 false */
  mpfEnabled: boolean;
  /** 與課表 tutor 欄／覆寫顯示名稱比對 */
  matchNames: string[];
};

function isMpfColumnMissingMessage(message: string | undefined): boolean {
  const m = String(message ?? "");
  return /\bmpf_enabled\b/i.test(m) && /\bdoes not exist\b/i.test(m);
}

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
  mpf_enabled?: boolean | null;
}): TutorNavEntry {
  const statusRaw = String(row.status ?? "工作中").trim();
  const status = STATUS_ORDER.includes(statusRaw as TutorNavStatus)
    ? (statusRaw as TutorNavStatus)
    : "工作中";
  const n = String(row.name ?? "").trim();
  const z = String(row.name_zh ?? "").trim();
  const e = String(row.name_en ?? "").trim();
  const nick = String(row.nickname_en ?? "").trim();
  // Prefer Tutor page Nickname (stored in `name`), then Chinese, then legacy nickname_en, then English.
  const displayName = n || z || nick || e || row.id;
  const englishName = e || n || nick || z || row.id;
  const matchNames = [...new Set([n, z, e, nick].filter(Boolean))];
  return {
    id: row.id,
    displayName,
    englishName,
    status,
    mpfEnabled: Boolean(row.mpf_enabled),
    matchNames,
  };
}

const TUTORS_SELECT_WITH_MPF =
  "id, name, name_zh, name_en, nickname_en, status, mpf_enabled";
const TUTORS_SELECT_BASE = "id, name, name_zh, name_en, nickname_en, status";

type TutorRowForNav = Parameters<typeof rowToEntry>[0];

export async function fetchTutorsForMonthlyLessonNav(): Promise<{
  tutors: TutorNavEntry[];
}> {
  const supabase = await createSupabaseServerClient();
  const first = await supabase.from("tutors").select(TUTORS_SELECT_WITH_MPF).order("id");
  let rows: TutorRowForNav[] | null = first.data as TutorRowForNav[] | null;
  let error = first.error;
  if (error && isMpfColumnMissingMessage(error.message)) {
    const second = await supabase.from("tutors").select(TUTORS_SELECT_BASE).order("id");
    rows = second.data as TutorRowForNav[] | null;
    error = second.error;
  }
  if (error || !rows?.length) return { tutors: [] };
  const entries = rows.map((row) => rowToEntry(row));
  entries.sort((a, b) => {
    const ra = rankStatus(a.status);
    const rb = rankStatus(b.status);
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });
  return { tutors: entries };
}

export async function fetchTutorNavEntryById(id: string): Promise<TutorNavEntry | null> {
  const supabase = await createSupabaseServerClient();
  const first = await supabase
    .from("tutors")
    .select(TUTORS_SELECT_WITH_MPF)
    .eq("id", id)
    .maybeSingle();
  let row: TutorRowForNav | null = first.data as TutorRowForNav | null;
  let error = first.error;
  if (error && isMpfColumnMissingMessage(error.message)) {
    const second = await supabase
      .from("tutors")
      .select(TUTORS_SELECT_BASE)
      .eq("id", id)
      .maybeSingle();
    row = second.data as TutorRowForNav | null;
    error = second.error;
  }
  if (error || !row) return null;
  return rowToEntry(row);
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
