"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { FALLBACK_ROOM_NAV_LINKS, type RoomNavItem } from "@/lib/roomConstants";
import { defaultDailyTimetablePath } from "@/lib/tutorRoomAccess";
import { supabase } from "@/lib/supabase";

export type HighlightKey =
  | "dashboard"
  | "daily-timetable"
  | "regular-timetable"
  | "students"
  | "reports"
  | "rooms"
  | "room"
  | null;

type MeNavResponse = {
  ok?: boolean;
  role?: string | null;
  isSharedIpadTutor?: boolean;
  roomNavLinks?: RoomNavItem[] | null;
  roomScheduleQuery?: string | null;
};

export default function AppTopNavContent({ highlight = null }: { highlight?: HighlightKey }) {
  const [roomLinks, setRoomLinks] = useState<RoomNavItem[]>(FALLBACK_ROOM_NAV_LINKS);
  const [roomScheduleQuery, setRoomScheduleQuery] = useState("");
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const pathname = usePathname();
  const isAdminNav = viewerRole === "admin";
  const isTutorRole = viewerRole === "tutor";
  const showTutorMenu = isTutorRole;

  async function onLogOut() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.assign("/login");
    }
  }

  useEffect(() => {
    let mounted = true;

    async function loadNav() {
      try {
        const res = await fetch("/api/me", { credentials: "same-origin" });
        if (res.ok) {
          const body = (await res.json()) as MeNavResponse;
          if (!mounted) return;
          const role = String(body.role ?? "").toLowerCase() || null;
          setViewerRole(role);
          setRoomScheduleQuery(String(body.roomScheduleQuery ?? "").trim());
          if (role === "tutor" && body.roomNavLinks?.length) {
            setRoomLinks(body.roomNavLinks);
            return;
          }
        }
      } catch {
        /* fallback to classrooms list */
      }

      const { data, error } = await supabase
        .from("classrooms")
        .select("id, name, slug, sort_order")
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

      if (!mounted || error || !data?.length) return;
      setRoomLinks(
        data.map((r) => ({
          href: `/rooms/${encodeURIComponent(String(r.slug).trim().toLowerCase())}`,
          label: String(r.name).trim(),
        })),
      );
    }

    void loadNav();

    const onClassroomsUpdated = () => {
      void loadNav();
    };
    window.addEventListener("beyondmath:classrooms-updated", onClassroomsUpdated);

    return () => {
      mounted = false;
      window.removeEventListener("beyondmath:classrooms-updated", onClassroomsUpdated);
    };
  }, []);

  const base =
    "shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition active:bg-white/30 active:font-semibold sm:px-2.5 sm:text-sm";
  const idle = "bg-white/15 hover:bg-white/25";
  const active = "bg-white/30 font-semibold";
  const isMatch = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

  const activeMap: Record<Exclude<HighlightKey, null>, boolean> = {
    dashboard: pathname === "/home",
    "daily-timetable": isMatch("/daily-time-table"),
    "regular-timetable": isMatch("/regular-class-timetable"),
    students: isMatch("/students"),
    reports: isMatch("/tutor") || isMatch("/teacher") || isMatch("/tutor-monthly-lesson-record"),
    rooms: isMatch("/rooms"),
    room: isMatch("/rooms"),
  };
  const isActive = (key: Exclude<HighlightKey, null>) => activeMap[key] || highlight === key;

  function roomNavHref(item: RoomNavItem) {
    return roomScheduleQuery ? `${item.href}?${roomScheduleQuery}` : item.href;
  }

  function isRoomNavActive(item: RoomNavItem) {
    const path = item.href.split("?")[0] ?? item.href;
    return pathname === path || pathname.startsWith(`${path}/`);
  }

  return (
    <div className="contents">
      <nav
        className="fixed inset-x-0 top-0 z-[60] m-0"
        style={{ backgroundImage: PRIMARY_GRADIENT }}
        suppressHydrationWarning
      >
        <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6" suppressHydrationWarning>
          <div className="overflow-visible">
            <div className="flex items-center gap-2 px-3 py-2 text-white sm:gap-3 sm:px-5 sm:py-2.5">
              <div className="flex min-w-0 shrink-0 items-center gap-2">
                <Link
                  href={isTutorRole ? defaultDailyTimetablePath() : "/home"}
                  className="inline-flex shrink-0 items-center hover:opacity-90"
                  aria-label={isTutorRole ? "Go to daily timetable" : "Go to home"}
                >
                  <Image
                    src="/logo.png"
                    alt="Beyond Math logo"
                    width={32}
                    height={32}
                    className="h-7 w-7 rounded object-contain sm:h-8 sm:w-8"
                  />
                </Link>
                <span className="hidden truncate text-sm font-bold leading-tight tracking-tight sm:inline lg:text-base">
                  Beyond Math Management
                </span>
                <span className="truncate text-sm font-bold leading-tight sm:hidden">Beyond Math</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-visible sm:gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-1.5 gap-y-1 overflow-visible sm:gap-x-2">
                {isAdminNav ? (
                  <>
                    <Link
                      href="/daily-time-table"
                      className={`${base} ${isActive("daily-timetable") ? active : idle}`}
                    >
                      Daily Timetable
                    </Link>
                    <Link
                      href="/regular-class-timetable"
                      className={`${base} ${isActive("regular-timetable") ? active : idle}`}
                      aria-current={isActive("regular-timetable") ? "page" : undefined}
                    >
                      Regular Timetable
                    </Link>
                    <Link href="/students" className={`${base} ${isActive("students") ? active : idle}`}>
                      Student Info
                    </Link>
                    <Link
                      href="/students-lesson-time-fee-record"
                      className={`${base} ${isMatch("/students-lesson-time-fee-record") ? active : idle}`}
                    >
                      Student Lesson Time & Fee Records
                    </Link>
                  </>
                ) : showTutorMenu ? (
                  <>
                    <Link
                      href="/daily-time-table"
                      className={`${base} ${isActive("daily-timetable") ? active : idle}`}
                    >
                      Daily Timetable
                    </Link>
                    {roomLinks.map((item) => (
                      <Link
                        key={item.href}
                        href={roomNavHref(item)}
                        className={`${base} ${isRoomNavActive(item) ? active : idle}`}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </>
                ) : null}
                {isAdminNav ? (
                  <div className="relative z-[70] shrink-0 group">
                  <Link
                    href="/rooms"
                    className={`${base} ${isActive("room") ? active : idle} inline-flex items-center gap-0.5`}
                  >
                    Rooms
                    <span className="ml-0.5 text-[10px] opacity-80">▼</span>
                  </Link>
                    <div className="pointer-events-none invisible absolute left-0 top-full z-[70] min-w-[9rem] pt-1 opacity-0 transition group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100">
                      <div className="overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-slate-800 shadow-lg">
                        {roomLinks.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            className="block px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                {isAdminNav ? (
                  <>
                    <Link href="/tutor" className={`${base} ${isActive("reports") ? active : idle}`}>
                      Tutors
                    </Link>
                    <Link
                      href="/tutor-monthly-lesson-record"
                      className={`${base} ${isMatch("/tutor-monthly-lesson-record") ? active : idle}`}
                    >
                      Tutor Monthly Record
                    </Link>
                  </>
                ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void onLogOut()}
                  disabled={loggingOut}
                  className={`${base} ${idle} shrink-0 border border-white/35 bg-white/15 font-semibold disabled:cursor-not-allowed disabled:opacity-60`}
                  aria-label="Log out"
                >
                  {loggingOut ? "…" : "Log Out"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>
      <div className="min-h-[52px] sm:min-h-[56px]" />
    </div>
  );
}
