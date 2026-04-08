import { supabase } from "@/lib/supabase";
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

/** 依網址 slug 取得「課表比對用」房名（與學生 records 內 room 一致）。 */
export async function fetchClassroomScheduleLabel(slug: string): Promise<string | null> {
  const key = slug.trim().toLowerCase();
  const { data, error } = await supabase.from("classrooms").select("name").eq("slug", key).maybeSingle();
  if (!error && data?.name) {
    const n = String(data.name).trim();
    if (n) return n;
  }
  return FALLBACK_SLUG_TO_SCHEDULE_LABEL[key] ?? null;
}

export async function fetchClassroomMeta(slug: string): Promise<{
  id: string | null;
  label: string;
  description: string;
} | null> {
  const key = slug.trim().toLowerCase();
  const { data, error } = await supabase
    .from("classrooms")
    .select("id, name, description")
    .eq("slug", key)
    .maybeSingle();
  if (!error && data) {
    const label = String(data.name ?? "").trim();
    if (!label) return null;
    const description =
      String(data.description ?? "").trim() || `${label} 排課與使用資訊`;
    return { id: data.id ?? null, label, description };
  }
  const fb = FALLBACK_ROOM_PAGE_META[key];
  if (fb) return { id: null, label: fb.label, description: fb.description };
  return null;
}
