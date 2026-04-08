"use client";

import { useRouter } from "next/navigation";

type Props = {
  tutorId: string;
  year: number;
  month: number;
};

const Y_MIN = 2020;
const Y_MAX = 2035;

export default function TutorMonthlyYearMonthPicker({ tutorId, year, month }: Props) {
  const router = useRouter();
  const base = `/tutor-monthly-lesson-record/${encodeURIComponent(tutorId)}`;
  const value = `${year}-${String(month).padStart(2, "0")}`;

  function navigateToYm(ym: string) {
    const parsed = /^(\d{4})-(\d{2})$/.exec(ym);
    if (!parsed) return;
    let y = Number(parsed[1]);
    let m = Number(parsed[2]);
    y = Math.min(Y_MAX, Math.max(Y_MIN, y));
    m = Math.min(12, Math.max(1, m));
    router.push(`${base}?year=${y}&month=${m}`);
  }

  return (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">選擇年／月</span>
      <input
        suppressHydrationWarning
        type="month"
        value={value}
        min="2020-01"
        max="2035-12"
        onChange={(e) => {
          const v = e.target.value;
          if (v) navigateToYm(v);
        }}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold tabular-nums text-slate-800 shadow-sm outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/30"
      />
    </label>
  );
}
