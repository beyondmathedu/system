import type { ViewerContext } from "@/lib/authz";
import { defaultLessonYear } from "@/lib/lessonCalendar";
import { readMonthPart } from "@/lib/intlFormatParts";
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

/** 導師登入後／無權限時的預設落點 */
export function getTutorLandingPath(viewer: ViewerContext): string | null {
  const allowed = viewer.allowedRoomSlugs.map(normalizeRoomSlug).filter(Boolean);
  if (allowed.length === 0) return null;
  const first = allowed[0];
  return `/rooms/${encodeURIComponent(first)}?${defaultRoomScheduleSearch(viewer)}`;
}

export function buildTutorRoomNavLinks(allowedSlugs: string[]): RoomNavItem[] {
  const allowed = new Set(allowedSlugs.map(normalizeRoomSlug));
  return FALLBACK_ROOM_NAV_LINKS.filter((item) => {
    const slug = item.href.replace(/^\/rooms\//, "").toLowerCase();
    return allowed.has(slug);
  });
}

/** 導師不可進入的後台路徑（僅能看已授權房間課表） */
const TUTOR_BLOCKED_PREFIXES = [
  "/home",
  "/students",
  "/students-lesson-time-fee-record",
  "/regular-class-timetable",
  "/tutor",
  "/teacher",
  "/tutor-monthly-lesson-record",
] as const;

export function isPathBlockedForTutor(pathname: string): boolean {
  const p = pathname.split("?")[0] ?? "";
  if (p === "/rooms") return false;
  if (p.startsWith("/rooms/")) return false;
  return TUTOR_BLOCKED_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}
