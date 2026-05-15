import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  DEFAULT_DAY_TIMETABLE_STYLE,
  rowToDayTimetableStyleSettings,
  type DayTimetableStyleSettings,
} from "@/lib/dayTimetableStyleSettings";

const TABLE = "app_day_timetable_settings";

/** 讀取課表顏色／學費門檻；表或欄位不存在時回傳預設（僅 Server） */
export async function loadDayTimetableStyleSettings(): Promise<DayTimetableStyleSettings> {
  const supabase = await createSupabaseServerClient();
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
