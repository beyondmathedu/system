"use client";

import dynamic from "next/dynamic";

const StressReliefGames = dynamic(() => import("./StressReliefGames"), {
  ssr: false,
  loading: () => (
    <div
      className="mx-auto mt-6 max-w-[1500px] rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-16 sm:px-5 lg:px-6"
      aria-hidden
    />
  ),
});

export default function StressReliefGamesDynamic() {
  return <StressReliefGames />;
}
