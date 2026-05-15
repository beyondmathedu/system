import { unstable_cache } from "next/cache";
import {
  DEFAULT_DAY_TIMETABLE_STYLE,
  rowToDayTimetableStyleSettings,
  type DayTimetableStyleSettings,
} from "@/lib/dayTimetableStyleSettings";
import { SCHEDULE_CACHE_TAG_DAY_TIMETABLE } from "@/lib/scheduleCacheTags";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const TABLE = "app_day_timetable_settings";

async function loadDayTimetableStyleSettingsUncached(): Promise<DayTimetableStyleSettings> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", 1).maybeSingle();
  if (error) {
    const msg = error.message ?? "";
    if (/\b(app_day_timetable_settings|relation)\b/i.test(msg) && /\b(not exist|does not exist)\b/i.test(msg)) {
      return { ...DEFAULT_DAY_TIMETABLE_STYLE };
    }
    return { ...DEFAULT_DAY_TIMETABLE_STYLE };
  }
  return rowToDayTimetableStyleSettings(data as Record<string, unknown>);
}

const loadDayTimetableStyleSettingsCached = unstable_cache(
  loadDayTimetableStyleSettingsUncached,
  ["day-timetable-style-v1"],
  { revalidate: 120, tags: [SCHEDULE_CACHE_TAG_DAY_TIMETABLE] },
);

/** 讀取課表顏色／學費門檻；表或欄位不存在時回傳預設（僅 Server） */
export async function loadDayTimetableStyleSettings(): Promise<DayTimetableStyleSettings> {
  return loadDayTimetableStyleSettingsCached();
}
