"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { FALLBACK_ROOM_NAV_LINKS, type RoomNavItem } from "@/lib/roomConstants";
import { supabase } from "@/lib/supabase";

export type HighlightKey = "dashboard" | "students" | "reports" | "rooms" | "room" | null;

export default function AppTopNav({ highlight = null }: { highlight?: HighlightKey }) {
  const [roomLinks, setRoomLinks] = useState<RoomNavItem[]>(FALLBACK_ROOM_NAV_LINKS);

  useEffect(() => {
    let mounted = true;

    async function loadRoomLinks() {
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

    void loadRoomLinks();

    const onClassroomsUpdated = () => {
      void loadRoomLinks();
    };
    window.addEventListener("beyondmath:classrooms-updated", onClassroomsUpdated);

    return () => {
      mounted = false;
      window.removeEventListener("beyondmath:classrooms-updated", onClassroomsUpdated);
    };
  }, []);

  const base = "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 font-medium";
  const idle = "bg-white/15 hover:bg-white/25";
  const active = "bg-white/30 font-semibold";

  return (
    <>
      <div className="mb-0 h-[82px] sm:h-[78px]" />
      <nav
        className="fixed left-0 right-0 top-0 z-40"
        style={{ backgroundImage: PRIMARY_GRADIENT }}
      >
        <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
          <div className="overflow-visible">
            <div className="flex flex-col gap-3 px-6 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/"
              className="text-2xl font-bold tracking-tight sm:text-3xl hover:opacity-90"
            >
              Beyond Math Management
            </Link>
            <div className="flex flex-nowrap items-center gap-2 overflow-x-auto text-sm whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Link
            href="/daily-time-table"
            className={`${base} ${highlight === "dashboard" ? active : idle}`}
          >
            Daily Timetable
          </Link>
          <Link
            href="/regular-class-timetable"
            className={`${base} ${idle}`}
          >
            Regular Class Timetable
          </Link>
          <Link
            href="/students"
            className={`${base} ${highlight === "students" ? active : idle}`}
          >
            Students
          </Link>
          <Link href="/students-lesson-time-fee-record" className={`${base} ${idle}`}>
            Student Lesson Time & Fee Records
          </Link>
          <div className="relative group">
            <Link
              href="/rooms"
              className={`${base} ${highlight === "room" ? active : idle} inline-flex items-center gap-0.5`}
            >
              Rooms
              <span className="ml-0.5 text-[10px] opacity-80">▼</span>
            </Link>
            <div className="pointer-events-none invisible absolute left-0 top-full z-50 pt-1 opacity-0 transition group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100">
              <div className="overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-slate-800 shadow-lg">
                {roomLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block px-3 py-2 text-sm font-semibold hover:bg-slate-100"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <Link
            href="/tutor"
            className={`${base} ${highlight === "reports" ? active : idle}`}
          >
            Tutors
          </Link>
              <Link href="/tutor-monthly-lesson-record" className={`${base} ${idle}`}>
                Tutor Monthly Lesson Record
              </Link>
            </div>
          </div>
        </div>
      </div>
      </nav>
    </>
  );
}
