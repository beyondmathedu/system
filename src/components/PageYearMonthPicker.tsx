"use client";

import { useRouter } from "next/navigation";

type Props = {
  basePath: string;
  year: number;
  month: number;
  day?: number;
  yMin?: number;
  yMax?: number;
};

export default function PageYearMonthPicker({
  basePath,
  year,
  month,
  day,
  yMin = 2020,
  yMax = 2035,
}: Props) {
  const router = useRouter();
  const value = `${year}-${String(month).padStart(2, "0")}`;

  function navigateToYm(ym: string) {
    const parsed = /^(\d{4})-(\d{2})$/.exec(ym);
    if (!parsed) return;
    let y = Number(parsed[1]);
    let m = Number(parsed[2]);
    y = Math.min(yMax, Math.max(yMin, y));
    m = Math.min(12, Math.max(1, m));
    const dayQuery = typeof day === "number" && Number.isFinite(day) ? `&day=${day}` : "";
    router.push(`${basePath}?year=${y}&month=${m}${dayQuery}`);
  }

  return (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">選擇年／月</span>
      <input
        suppressHydrationWarning
        type="month"
        value={value}
        min={`${yMin}-01`}
        max={`${yMax}-12`}
        onChange={(e) => {
          const v = e.target.value;
          if (v) navigateToYm(v);
        }}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold tabular-nums text-slate-800 shadow-sm outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/30"
      />
    </label>
  );
}
