"use client";

import type { QuestionBBox } from "@/lib/questionBankTypes";

type Props = {
  pageDataUrl: string;
  pageWidth: number;
  pageHeight: number;
  bbox: QuestionBBox;
  label?: string;
  showOverlay?: boolean;
  className?: string;
};

export default function RegionCropPreview({
  pageDataUrl,
  pageWidth,
  pageHeight,
  bbox,
  label,
  showOverlay = false,
  className = "",
}: Props) {
  if (showOverlay) {
    return (
      <div className={`relative overflow-hidden rounded border border-slate-200 bg-white ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pageDataUrl} alt={label ?? "PDF page"} className="block h-auto w-full" />
        <div
          className="pointer-events-none absolute border-2 border-sky-500 bg-sky-400/10"
          style={{
            top: `${bbox.top}%`,
            left: `${bbox.left}%`,
            width: `${bbox.width}%`,
            height: `${bbox.height}%`,
          }}
        >
          {label ? (
            <span className="absolute left-0 top-0 bg-sky-600 px-1 text-[10px] font-bold text-white">
              {label}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  const x = (bbox.left / 100) * pageWidth;
  const y = (bbox.top / 100) * pageHeight;
  const w = Math.max(1, (bbox.width / 100) * pageWidth);
  const h = Math.max(1, (bbox.height / 100) * pageHeight);

  return (
    <div
      className={`overflow-hidden rounded border border-slate-200 bg-white ${className}`}
      style={{
        width: "100%",
        aspectRatio: `${w} / ${h}`,
        backgroundImage: `url(${pageDataUrl})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${pageWidth}px ${pageHeight}px`,
        backgroundPosition: `-${x}px -${y}px`,
      }}
      title={label}
      aria-label={label ?? "Question crop preview"}
    />
  );
}
