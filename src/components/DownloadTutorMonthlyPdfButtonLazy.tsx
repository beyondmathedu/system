"use client";

import dynamic from "next/dynamic";

const DownloadTutorMonthlyPdfButton = dynamic(
  () => import("@/components/DownloadTutorMonthlyPdfButton"),
  {
    ssr: false,
    loading: () => (
      <button
        type="button"
        disabled
        className="fixed right-6 bottom-6 z-50 inline-flex w-36 items-center justify-center rounded-full bg-[#1d76c2]/70 px-4 py-3 text-sm font-semibold text-white shadow-lg"
      >
        Download PDF
      </button>
    ),
  },
);

type Props = {
  fileName: string;
  head: string[];
  body: Array<Array<string | number>>;
};

/** Defers the PDF helper bundle until the monthly record page needs it. */
export default function DownloadTutorMonthlyPdfButtonLazy(props: Props) {
  return <DownloadTutorMonthlyPdfButton {...props} />;
}
