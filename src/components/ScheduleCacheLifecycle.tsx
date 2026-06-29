"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { flushSaveLessonScheduleRecordsQueue, hasPendingLessonScheduleRecordsSaves } from "@/lib/queueSaveLessonScheduleRecords";
import { flushSaveLessonYearStateQueue, hasPendingLessonYearStateSaves } from "@/lib/queueSaveLessonYearState";
import {
  hasPendingScheduleCacheRevalidation,
  primeScheduleCacheRevalidationOnNavigate,
  revalidateScheduleCachesNow,
} from "@/lib/scheduleCacheClient";

function hasPendingScheduleWork(): boolean {
  return (
    hasPendingScheduleCacheRevalidation() ||
    hasPendingLessonYearStateSaves() ||
    hasPendingLessonScheduleRecordsSaves()
  );
}

/**
 * Keeps room / day timetable server caches aligned after saves when users navigate in-app.
 * Full page unload is handled by the save queues' pagehide hooks.
 */
export default function ScheduleCacheLifecycle() {
  const pathname = usePathname();
  const router = useRouter();
  const isFirstPath = useRef(true);

  useEffect(() => {
    const onLinkClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor || anchor.getAttribute("target") === "_blank") return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

      if (href.startsWith("http://") || href.startsWith("https://")) {
        try {
          const url = new URL(href);
          if (url.origin !== window.location.origin) return;
        } catch {
          return;
        }
      }

      if (hasPendingScheduleCacheRevalidation()) {
        primeScheduleCacheRevalidationOnNavigate();
      }
    };

    document.addEventListener("click", onLinkClick, true);
    return () => document.removeEventListener("click", onLinkClick, true);
  }, []);

  useEffect(() => {
    if (isFirstPath.current) {
      isFirstPath.current = false;
      return;
    }

    if (!hasPendingScheduleWork()) return;

    void (async () => {
      await Promise.all([flushSaveLessonYearStateQueue(), flushSaveLessonScheduleRecordsQueue()]);
      await revalidateScheduleCachesNow();
      router.refresh();
    })();
  }, [pathname, router]);

  return null;
}
