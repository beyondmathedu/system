import Link from "next/link";
import { studentLessonsYearPath } from "@/lib/lessonCalendar";

export type HomeReminderRow = {
  studentId: string;
  displayName: string;
  detail: string;
};

type Props = {
  title: string;
  titleClassName: string;
  borderClassName: string;
  bgClassName: string;
  logicTitle: string;
  logicLines: string[];
  rows: HomeReminderRow[];
  emptyTitle: string;
  emptyHint?: string;
  footerLink?: { href: string; label: string };
};

export default function HomeReminderPanel({
  title,
  titleClassName,
  borderClassName,
  bgClassName,
  logicTitle,
  logicLines,
  rows,
  emptyTitle,
  emptyHint,
  footerLink,
}: Props) {
  return (
    <section className={`rounded-2xl border p-5 ${borderClassName} ${bgClassName}`}>
      <h2 className={`text-base font-bold ${titleClassName}`}>{title}</h2>
      <div className="mt-3 rounded-lg border border-slate-200/80 bg-white/70 px-3 py-2.5">
        <p className="text-xs font-semibold text-slate-700">{logicTitle}</p>
        <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs leading-relaxed text-slate-600">
          {logicLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      {rows.length > 0 ? (
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-sm">
          {rows.map((row) => (
            <li
              key={`${row.studentId}-${row.detail}`}
              className="rounded-md border border-slate-200/60 bg-white/80 px-3 py-2"
            >
              <Link
                href={studentLessonsYearPath(row.studentId)}
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
      {footerLink ? (
        <Link
          href={footerLink.href}
          className="mt-3 inline-flex text-xs font-semibold text-[#1d76c2] hover:underline"
        >
          {footerLink.label}
        </Link>
      ) : null}
    </section>
  );
}
