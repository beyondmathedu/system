import { unstable_cache } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { FALLBACK_ROOM_PAGE_META, FALLBACK_SLUG_TO_SCHEDULE_LABEL } from "@/lib/roomConstants";

export type ClassroomRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  /** 恆常班每時段人數上限；null 則用程式預設 */
  regular_period_max?: number | null;
};

async function fetchClassroomScheduleLabelUncached(slugKey: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("classrooms").select("name").eq("slug", slugKey).maybeSingle();
  if (!error && data?.name) {
    const n = String(data.name).trim();
    if (n) return n;
  }
  return FALLBACK_SLUG_TO_SCHEDULE_LABEL[slugKey] ?? null;
}

/** 依網址 slug 取得「課表比對用」房名（與學生 records 內 room 一致）。 */
export async function fetchClassroomScheduleLabel(slug: string): Promise<string | null> {
  const slugKey = slug.trim().toLowerCase();
  return unstable_cache(
    async () => fetchClassroomScheduleLabelUncached(slugKey),
    ["classroom-schedule-label-v1", slugKey],
    { revalidate: 300 },
  )();
}

async function fetchClassroomMetaUncached(slugKey: string): Promise<{
  id: string | null;
  label: string;
  description: string;
} | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("classrooms")
    .select("id, name, description")
    .eq("slug", slugKey)
    .maybeSingle();
  if (!error && data) {
    const label = String(data.name ?? "").trim();
    if (!label) return null;
    const description =
      String(data.description ?? "").trim() || `${label} 排課與使用資訊`;
    return { id: data.id ?? null, label, description };
  }
  const fb = FALLBACK_ROOM_PAGE_META[slugKey];
  if (fb) return { id: null, label: fb.label, description: fb.description };
  return null;
}

export async function fetchClassroomMeta(slug: string): Promise<{
  id: string | null;
  label: string;
  description: string;
} | null> {
  const slugKey = slug.trim().toLowerCase();
  return unstable_cache(
    async () => fetchClassroomMetaUncached(slugKey),
    ["classroom-meta-v1", slugKey],
    { revalidate: 300 },
  )();
}
