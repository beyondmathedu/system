"use client";

import type { QuestionBBox } from "@/lib/questionBankTypes";

type Region = {
  id: string;
  bbox: QuestionBBox;
  label?: string;
};

type Props = {
  pageDataUrl: string;
  regions: Region[];
  className?: string;
};

export default function PageWithRegionsOverlay({ pageDataUrl, regions, className = "" }: Props) {
  return (
    <div className={`relative overflow-hidden rounded border border-slate-200 bg-white ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={pageDataUrl} alt="PDF page" className="block h-auto w-full" />
      {regions.map((region) => (
        <div
          key={region.id}
          className="pointer-events-none absolute border-2 border-amber-500 bg-amber-300/10"
          style={{
            top: `${region.bbox.top}%`,
            left: `${region.bbox.left}%`,
            width: `${region.bbox.width}%`,
            height: `${region.bbox.height}%`,
          }}
        >
          {region.label ? (
            <span className="absolute left-0 top-0 bg-amber-600 px-1 text-[10px] font-bold text-white">
              {region.label}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
