"use client";

import { useRouter } from "next/navigation";

type Props = {
  basePath: string;
  year: number;
  month: number;
  day: number;
};

export default function PageDatePicker({ basePath, year, month, day }: Props) {
  const router = useRouter();
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  function navigateToDate(ymd: string) {
    const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!parsed) return;
    const y = Number(parsed[1]);
    const m = Number(parsed[2]);
    const d = Number(parsed[3]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return;
    router.push(`${basePath}?year=${y}&month=${m}&day=${d}`);
  }

  return (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">選擇年／月／日</span>
      <input
        suppressHydrationWarning
        type="date"
        value={value}
        min="2020-01-01"
        max="2035-12-31"
        onChange={(e) => {
          const v = e.target.value;
          if (v) navigateToDate(v);
        }}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold tabular-nums text-slate-800 shadow-sm outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/30"
      />
    </label>
  );
}
