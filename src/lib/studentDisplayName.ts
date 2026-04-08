/**
 * 全站統一：學生顯示名（避免各頁自行拼 name_zh / nickname_en / name_en）。
 */

export type StudentNameFields = {
  id: string;
  name_zh?: string | null;
  name_en?: string | null;
  nickname_en?: string | null;
};

/** full：中文 +（暱稱優先，冇暱稱先至用英文全名）；唔會同時疊暱稱同英文 */
/** compact：中文 + 暱稱（格仔窄、日課表；冇暱稱就只有中文） */
export type StudentDisplayNameVariant = "full" | "compact";

export function formatStudentDisplayName(
  st: StudentNameFields,
  variant: StudentDisplayNameVariant = "full",
): string {
  const zh = (st.name_zh ?? "").trim();
  const nick = (st.nickname_en ?? "").trim();
  const en = (st.name_en ?? "").trim();

  if (variant === "compact") {
    const s = [zh, nick].filter(Boolean).join(" ").trim();
    return s || st.id;
  }

  const secondary = nick || en;
  const s = [zh, secondary].filter(Boolean).join(" ").trim();
  return s || st.id;
}

/** 三者皆空時回傳 whenEmpty（預設「—」），唔用學號兜底。 */
export function formatStudentDisplayNameOrEmpty(
  st: StudentNameFields,
  variant: StudentDisplayNameVariant = "full",
  whenEmpty: string = "—",
): string {
  const zh = (st.name_zh ?? "").trim();
  const nick = (st.nickname_en ?? "").trim();
  const en = (st.name_en ?? "").trim();
  if (!zh && !nick && !en) return whenEmpty;
  return formatStudentDisplayName(st, variant);
}
