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
/** compact：中文 + 暱稱（日課表格仔窄）；冇暱稱時用單詞英文名作後備（例：name_en=Ashley） */
export type StudentDisplayNameVariant = "full" | "compact";

function compactSecondaryName(nick: string, en: string): string {
  if (nick) return nick;
  // Avoid long English full names in narrow timetable cells.
  if (en && !/\s/.test(en)) return en;
  return "";
}

export function formatStudentDisplayName(
  st: StudentNameFields,
  variant: StudentDisplayNameVariant = "full",
): string {
  const zh = (st.name_zh ?? "").trim();
  const nick = (st.nickname_en ?? "").trim();
  const en = (st.name_en ?? "").trim();

  if (variant === "compact") {
    const s = [zh, compactSecondaryName(nick, en)].filter(Boolean).join(" ").trim();
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
