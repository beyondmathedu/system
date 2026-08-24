import { fetchClassroomNavLinks } from "@/lib/classroomsRegistry";
import type { ViewerContext } from "@/lib/authz";
import { defaultLessonYear } from "@/lib/lessonCalendar";
import { readMonthPart } from "@/lib/intlFormatParts";
import { hkTodayYmd } from "@/lib/dayTimetableShared";
import { FALLBACK_ROOM_NAV_LINKS, type RoomNavItem } from "@/lib/roomConstants";

function hkMonthNow(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
  }).formatToParts(new Date());
  return Number(readMonthPart(parts, "1")) || 1;
}

/** 課室課表 URL 查詢字串：共用 iPad 預設 Today，其他導師預設整月 */
export function defaultRoomScheduleSearchFromFlag(isSharedIpadTutor: boolean): string {
  const month = hkMonthNow();
  const year = defaultLessonYear();
  return isSharedIpadTutor
    ? `year=${year}&month=${month}&period=today`
    : `year=${year}&month=${month}&period=month`;
}

export function defaultRoomScheduleSearch(viewer: ViewerContext): string {
  return defaultRoomScheduleSearchFromFlag(isSharedIpadTutorViewer(viewer));
}

/** 與 public.classrooms.slug 一致 */
export const ALL_CLASSROOM_SLUGS = ["b", "m-qian", "m-hou", "hope", "hope-2"] as const;

export function normalizeRoomSlug(slug: string): string {
  return String(slug ?? "").trim().toLowerCase();
}

export function isTutorViewer(viewer: ViewerContext): boolean {
  return viewer.role === "tutor";
}

export function tutorAllowedSlugSet(viewer: ViewerContext): Set<string> {
  return new Set(viewer.allowedRoomSlugs.map(normalizeRoomSlug).filter(Boolean));
}

export function isSharedIpadTutorViewer(viewer: ViewerContext): boolean {
  return viewer.isSharedIpadTutor === true;
}

export function tutorCanAccessRoomSlug(viewer: ViewerContext, slug: string): boolean {
  if (!isTutorViewer(viewer)) return true;
  if (isSharedIpadTutorViewer(viewer)) return true;
  return tutorAllowedSlugSet(viewer).has(normalizeRoomSlug(slug));
}

export function defaultDailyTimetablePath(): string {
  const { y, m, d } = hkTodayYmd();
  return `/daily-time-table?year=${y}&month=${m}&day=${d}`;
}

/** Room page query when linking from Daily Timetable on a given date. */
export function buildRoomScheduleQueryForDate(viewer: ViewerContext, dateIso: string): string {
  if (isTutorViewer(viewer) && !isSharedIpadTutorViewer(viewer)) {
    return defaultRoomScheduleSearch(viewer);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) return defaultRoomScheduleSearch(viewer);
  const year = m[1];
  const month = String(Number(m[2]));
  return `year=${year}&month=${month}&period=custom&from=${dateIso}&to=${dateIso}`;
}

/** 導師登入後／無權限時的預設落點 */
export function getTutorLandingPath(_viewer?: ViewerContext): string | null {
  void _viewer;
  return defaultDailyTimetablePath();
}

export function buildTutorRoomNavLinks(
  allowedSlugs: string[],
  classroomLinks: RoomNavItem[] = FALLBACK_ROOM_NAV_LINKS,
): RoomNavItem[] {
  const allowed = new Set(allowedSlugs.map(normalizeRoomSlug));
  return classroomLinks.filter((item) => {
    const slug = item.href.replace(/^\/rooms\//, "").toLowerCase();
    return allowed.has(slug);
  });
}

/** Shared iPad sees every classroom; other tutors see only granted slugs. */
export async function loadTutorRoomNavLinks(viewer: ViewerContext): Promise<RoomNavItem[]> {
  const classroomLinks = await fetchClassroomNavLinks();
  if (isSharedIpadTutorViewer(viewer)) return classroomLinks;
  return buildTutorRoomNavLinks(viewer.allowedRoomSlugs, classroomLinks);
}

/** 導師不可進入的後台路徑（僅能看已授權房間課表） */
const TUTOR_BLOCKED_PREFIXES = [
  "/home",
  "/students",
  "/students-lesson-time-fee-record",
  "/regular-class-timetable",
  "/teacher",
  "/tutor-monthly-lesson-record",
] as const;

export function isPathBlockedForTutor(pathname: string): boolean {
  const p = pathname.split("?")[0] ?? "";
  if (p === "/rooms") return false;
  if (p.startsWith("/rooms/")) return false;
  if (p === "/daily-time-table" || p.startsWith("/daily-time-table/")) return false;
  if (/^\/students\/[^/]+\/lessons(\/|$)/.test(p)) return false;
  return TUTOR_BLOCKED_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}
