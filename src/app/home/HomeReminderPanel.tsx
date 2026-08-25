import Link from "next/link";
import { studentLessonsYearPath } from "@/lib/lessonCalendar";

export type HomeReminderRow = {
  studentId: string;
  displayName: string;
  detail: string;
  /** Used for sort priority when present. */
  count?: number;
  /** Defaults to student year lessons page. */
  href?: string;
};

type Props = {
  title: string;
  titleClassName: string;
  borderClassName: string;
  bgClassName: string;
  /** One-line scope / meaning under the title (preferred over a logic box). */
  subtitle?: string;
  rows: HomeReminderRow[];
  emptyTitle: string;
  emptyHint?: string;
};

export default function HomeReminderPanel({
  title,
  titleClassName,
  borderClassName,
  bgClassName,
  subtitle,
  rows,
  emptyTitle,
  emptyHint,
}: Props) {
  return (
    <section className={`rounded-2xl border p-5 ${borderClassName} ${bgClassName}`}>
      <h2 className={`text-base font-bold ${titleClassName}`}>{title}</h2>
      {subtitle ? <p className="mt-1 text-xs leading-relaxed text-slate-600">{subtitle}</p> : null}
      {rows.length > 0 ? (
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-sm">
          {rows.map((row) => (
            <li
              key={`${row.studentId}-${row.detail}`}
              className="rounded-md border border-slate-200/60 bg-white/80 px-3 py-2"
            >
              <Link
                href={row.href ?? studentLessonsYearPath(row.studentId)}
                className="font-semibold text-[#1d76c2] hover:underline"
              >
                {row.displayName}
              </Link>
              <p className="mt-0.5 text-xs text-slate-600">{row.detail}</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-white/50 px-3 py-4 text-center">
          <p className={`text-sm font-medium ${titleClassName}`}>{emptyTitle}</p>
          {emptyHint ? <p className="mt-1 text-xs text-slate-600">{emptyHint}</p> : null}
        </div>
      )}
    </section>
  );
}
