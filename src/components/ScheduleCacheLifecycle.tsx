"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Keeps room / day timetable server caches aligned after saves when users navigate in-app.
 * Heavy save-queue modules are loaded lazily so root layout stays small.
 */
export default function ScheduleCacheLifecycle() {
  const pathname = usePathname();
  const router = useRouter();
  const isFirstPath = useRef(true);

  useEffect(() => {
    let cancelled = false;
    let removeClick: (() => void) | undefined;

    void import("@/lib/scheduleCacheClient").then(
      ({ hasPendingScheduleCacheRevalidation, primeScheduleCacheRevalidationOnNavigate }) => {
        if (cancelled) return;

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
        removeClick = () => document.removeEventListener("click", onLinkClick, true);
      },
    );

    return () => {
      cancelled = true;
      removeClick?.();
    };
  }, []);

  useEffect(() => {
    if (isFirstPath.current) {
      isFirstPath.current = false;
      return;
    }

    let cancelled = false;

    void (async () => {
      const [
        { hasPendingScheduleCacheRevalidation, revalidateScheduleCachesNow },
        { flushSaveLessonYearStateQueue, hasPendingLessonYearStateSaves },
        { flushSaveLessonScheduleRecordsQueue, hasPendingLessonScheduleRecordsSaves },
      ] = await Promise.all([
        import("@/lib/scheduleCacheClient"),
        import("@/lib/queueSaveLessonYearState"),
        import("@/lib/queueSaveLessonScheduleRecords"),
      ]);

      if (cancelled) return;

      const hasPending =
        hasPendingScheduleCacheRevalidation() ||
        hasPendingLessonYearStateSaves() ||
        hasPendingLessonScheduleRecordsSaves();

      if (!hasPending) return;

      await Promise.all([flushSaveLessonYearStateQueue(), flushSaveLessonScheduleRecordsQueue()]);
      if (cancelled) return;

      await revalidateScheduleCachesNow();
      if (cancelled) return;

      router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
