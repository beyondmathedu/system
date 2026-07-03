import Link from "next/link";
import type { DayTimetableStyleSettings } from "@/lib/dayTimetableStyleSettings";
import { dayTimetableLegendStrings } from "@/lib/dayTimetableUiStrings";

type Props = {
  timetableStyle: DayTimetableStyleSettings;
  showCapacityLegend?: boolean;
  hideRemarks?: boolean;
};

export default function DayTimetableLegend({
  timetableStyle,
  showCapacityLegend = false,
  hideRemarks = false,
}: Props) {
  const t = dayTimetableLegendStrings;

  const titleClass = "font-semibold text-slate-700";

  return (
    <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs leading-relaxed text-slate-600">
      <p>
        <span className={titleClass}>{hideRemarks ? t.examOnlyTitle : t.examRemarksTitle}: </span>
        {hideRemarks ? t.examOnlyBody : t.examRemarksBody}
      </p>
      <p>
        <span className={titleClass}>{t.coloursTitle}: </span>
        {t.coloursRegular}
        <span
          className="mx-0.5 inline-block h-3 w-5 rounded-sm align-[-2px] ring-1 ring-violet-200/80"
          style={{ backgroundColor: timetableStyle.rescheduleCellBgHex }}
          title={t.swatchTitleResched}
        />
        {t.coloursResched}
        <span
          className="mx-0.5 inline-block h-3 w-5 rounded-sm align-[-2px] ring-1 ring-amber-200/80"
          style={{ backgroundColor: timetableStyle.extraCellBgHex }}
          title={t.swatchTitleExtra}
        />
        {t.coloursExtra}
        {t.feeUnpaidMonth}
        <span
          className="mx-0.5 inline-block h-3 w-1.5 rounded-sm align-middle"
          style={{ backgroundColor: timetableStyle.feeUnpaidStripeHex }}
        />
        {t.feeUpToOneMonth}
        <span
          className="mx-0.5 inline-block h-3 w-1.5 rounded-sm align-middle"
          style={{ backgroundColor: timetableStyle.feeArrearsStripeHex }}
        />
        {t.feeOverOneMonth}{" "}
        {t.coloursEditHint}
      </p>
      {showCapacityLegend ? (
        <p>
          <span className={titleClass}>{t.capacityTitle}: </span>
          {t.capacityBeforeLink}
          <Link href="/rooms" className="font-semibold text-[#1d76c2] underline">
            Rooms
          </Link>
          {t.capacityAfterLink}
        </p>
      ) : null}
    </div>
  );
}
