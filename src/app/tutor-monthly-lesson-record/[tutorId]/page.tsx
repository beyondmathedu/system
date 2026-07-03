import Link from "next/link";
import { notFound } from "next/navigation";
import AppTopNav from "@/components/AppTopNav";
import TutorMonthlyYearMonthPicker from "@/components/TutorMonthlyYearMonthPicker";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { fetchTutorMonthLessonRows } from "@/lib/roomScheduleAggregate";
import {
  fetchTutorNavEntryById,
  TUTOR_NAV_STATUS_LABEL,
  tutorNavStatusBadgeClass,
} from "@/lib/tutorMonthlyNav";
import {
  classifyGradeBand,
  enrichTutorMonthRowsWithPay,
  formatLessonTimeRangeLine,
  gradeRank,
} from "@/lib/tutorMonthlyPayroll";
import { loadLatestTutorRates, loadMultiStudentFirstAmount } from "@/lib/payrollSettings";
import { readYmParts } from "@/lib/intlFormatParts";
import DownloadTutorMonthlyPdfButton from "@/components/DownloadTutorMonthlyPdfButton";
import { formatGradeDisplay } from "@/lib/grade";

export const dynamic = "force-dynamic";

/** 人工高於此金額時，MPF 導師顯示僱主供款（人工的 5%） */
const MPF_RELEVANT_INCOME_THRESHOLD = 7100;
const MPF_EMPLOYER_CONTRIBUTION_RATE = 0.05;

function hkTodayYm() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const { y: ys, m: ms } = readYmParts(parts, { y: "2026", m: "01" });
  return { y: Number(ys) || 2026, m: Number(ms) || 1 };
}

function shiftMonth(year: number, month: number, delta: number) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

function toCsvCell(v: string | number) {
  const s = String(v ?? "");
  const escaped = s.replace(/"/g, "\"\"");
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function formatMonthDay(dateIso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateIso ?? "").trim());
  if (!m) return dateIso;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** CSV 下載時避免被 Excel 自動轉成本地日期格式（例如 7月4日 / Apr-14） */
function csvDateText(dateIso: string) {
  const md = formatMonthDay(dateIso);
  // 以公式字串輸出，Excel 會顯示為純文字 4/7、4/14
  return `="${md}"`;
}

type PageProps = {
  params: Promise<{ tutorId: string }>;
  searchParams?: Promise<{ year?: string; month?: string }>;
};

export default async function TutorMonthlyLessonRecordDetailPage({ params, searchParams }: PageProps) {
  const { tutorId: rawId } = await params;
  const tutorId = decodeURIComponent(rawId);
  const sp = searchParams ? await searchParams : {};
  const { y: defY, m: defM } = hkTodayYm();
  const year = Math.min(2035, Math.max(2020, Number(sp.year) || defY));
  const month = Math.min(12, Math.max(1, Number(sp.month) || defM));

  const entry = await fetchTutorNavEntryById(tutorId);
  if (!entry) notFound();

  const [{ rows, loadError }, rates, multiStudentFirstAmount] = await Promise.all([
    fetchTutorMonthLessonRows(entry.matchNames, year, month),
    loadLatestTutorRates(tutorId),
    loadMultiStudentFirstAmount(),
  ]);
  const normalizedRowsForPay = (() => {
    const seen = new Set<string>();
    const out = [];
    for (const r of rows) {
      // 先去重：同一學生 + 同一日期 + 同一時間，只保留一筆（避免重覆資料令時段計價放大）
      const timeKey = r.time.trim().toLowerCase().replace(/\s+/g, " ");
      const key = `${r.studentId}|||${r.dateIso}|||${timeKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  })();
  const { rowsWithPay } = enrichTutorMonthRowsWithPay(
    normalizedRowsForPay,
    rates,
    multiStudentFirstAmount,
  );

  // 合併：同一「日期 + 時間」視為同一時段（同頁說明的 payGroupKey 規則）
  const groupedRows = (() => {
    type Group = {
      groupKey: string;
      dateIso: string;
      dateDisplay: string;
      time: string;
      hours: number;
      subtotal: number;
      studentIdSet: Set<string>;
      students: Array<{ studentId: string; studentName: string; grade: string; amount: number }>;
    };
    const byKey = new Map<string, Group>();
    const ordered: Group[] = [];
    for (const r of rowsWithPay) {
      const groupKey = `${r.dateIso}|||${r.time.trim().toLowerCase().replace(/\s+/g, " ")}`;
      const found = byKey.get(groupKey);
      if (!found) {
        const next: Group = {
          groupKey,
          dateIso: r.dateIso,
          dateDisplay: r.dateDisplay,
          time: r.time,
          hours: r.hours,
          subtotal: 0,
          studentIdSet: new Set([r.studentId]),
          students: [{ studentId: r.studentId, studentName: r.studentName, grade: r.grade, amount: 0 }],
        };
        byKey.set(groupKey, next);
        ordered.push(next);
        continue;
      }
      // 同一時段若同一學生重複出現，只保留一次，且不重複計小計
      if (!found.studentIdSet.has(r.studentId)) {
        found.studentIdSet.add(r.studentId);
        found.students.push({ studentId: r.studentId, studentName: r.studentName, grade: r.grade, amount: 0 });
      }
    }
      // 以「畫面實際顯示學生（已去重）」重算每時段小計，避免原始列重覆造成誤差
      for (const g of ordered) {
        const sorted = g.students
          .map((st) => ({ ...st, band: classifyGradeBand(st.grade) }))
          .sort((a, b) => {
            const ra = gradeRank(a.grade);
            const rb = gradeRank(b.grade);
            if (ra !== rb) return ra - rb;
            return a.studentId.localeCompare(b.studentId);
          });
        if (sorted.length === 0) {
          g.subtotal = 0;
          g.students = [];
        } else if (sorted.length === 1) {
          sorted[0].amount = rates.single;
          g.subtotal = sorted[0].amount;
          g.students = sorted.map(({ studentId, studentName, grade, amount }) => ({
            studentId,
            studentName,
            grade,
            amount,
          }));
        } else {
          sorted[0].amount = multiStudentFirstAmount;
          for (let i = 1; i < sorted.length; i++) {
            sorted[i].amount = sorted[i].band === "senior" ? rates.senior : rates.junior;
          }
          g.students = sorted.map(({ studentId, studentName, grade, amount }) => ({
            studentId,
            studentName,
            grade,
            amount,
          }));
          g.subtotal = g.students.reduce((sum, st) => sum + (Number(st.amount) || 0), 0);
        }
        g.studentIdSet.clear();
      }
    return ordered;
  })();
  const monthTotal = groupedRows.reduce((sum, g) => sum + g.subtotal, 0);
  const showMpfEmployerLines =
    entry.mpfEnabled && monthTotal > MPF_RELEVANT_INCOME_THRESHOLD;
  const mpfEmployerAmount = showMpfEmployerLines
    ? Math.round(monthTotal * MPF_EMPLOYER_CONTRIBUTION_RATE * 100) / 100
    : 0;
  const salaryPlusMpf = showMpfEmployerLines
    ? Math.round((monthTotal + mpfEmployerAmount) * 100) / 100
    : monthTotal;
  const monthHourTotal = Math.round(groupedRows.reduce((sum, g) => sum + (Number(g.hours) || 0), 0) * 100) / 100;
  const ratesMissing = rates.single === 0 && rates.junior === 0 && rates.senior === 0;
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const base = `/tutor-monthly-lesson-record/${encodeURIComponent(tutorId)}`;
  const csvRows: Array<Array<string | number>> = [];
  csvRows.push([entry.displayName, "Date", "Time", "Hour", "Subtotal", "Grade", "Student Name"]);
  let csvYearShown = false;
  for (let gi = 0; gi < groupedRows.length; gi++) {
    const g = groupedRows[gi];
    const prevG = gi > 0 ? groupedRows[gi - 1] : null;
    const showDate = !prevG || prevG.dateIso !== g.dateIso;
    const students = g.students.length > 0 ? g.students : [{ studentId: "", studentName: "—", grade: "—", amount: 0 }];
    for (let si = 0; si < students.length; si++) {
      const st = students[si];
      csvRows.push([
        !csvYearShown ? `${year}` : "",
        si === 0 && showDate ? csvDateText(g.dateIso) : "",
        si === 0 ? formatLessonTimeRangeLine(g.time, g.hours) ?? g.time : "",
        si === 0 ? g.hours : "",
        st.studentId ? st.amount : "—",
        st.grade || "—",
        st.studentName || "—",
      ]);
      csvYearShown = true;
    }
  }
  csvRows.push(["", "", "Total", monthHourTotal, "—", "", ""]);
  csvRows.push(["", "", "Monthly Salary", "—", monthTotal, "", ""]);
  if (showMpfEmployerLines) {
    csvRows.push([
      "",
      "",
      "Employer MPF Contribution (5% of Relevant Income)",
      "—",
      mpfEmployerAmount,
      "",
      "",
    ]);
    csvRows.push(["", "", "Monthly Salary + Employer MPF Contribution", "—", salaryPlusMpf, "", ""]);
  }
  csvRows.push(["", "", "", "", "", "", ""]);
  csvRows.push(["", "Beyond Math Education Centre Limited", "", "", "", "", ""]);
  csvRows.push(["", "", "", "", "", "", ""]);
  csvRows.push(["", "Employer's Signature", "", "", "Employee's Signature", "", ""]);
  const csvContent =
    "\uFEFF" + csvRows.map((r) => r.map((c) => toCsvCell(c)).join(",")).join("\r\n");
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`;
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const tutorNamePart = `${entry.displayName || tutorId},${entry.englishName || tutorId}`.replace(
    /[\\/:*?"<>|]+/g,
    "_",
  );
  const csvFilename = `${tutorNamePart}_${ym}_monthly_lesson_record.csv`;
  const pdfFilename = `${tutorNamePart}_${ym}_monthly_lesson_record.pdf`;
  const pdfHead = csvRows[0].map((c) => String(c));
  const pdfBody = csvRows
    .slice(1)
    .map((r) =>
      r.map((c) => {
        if (typeof c === "string" && c.startsWith("=\"") && c.endsWith("\"")) {
          return c.slice(2, -1);
        }
        return c;
      }),
    );

  return (
    <div className="min-h-screen bg-slate-100 pt-5 pb-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Link href="/tutor-monthly-lesson-record" className="text-blue-100 hover:text-white hover:underline">
                ← All Tutors
              </Link>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{entry.displayName} — Monthly Lesson Record</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-blue-100">
              <span
                className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${tutorNavStatusBadgeClass(entry.status)}`}
              >
                {TUTOR_NAV_STATUS_LABEL[entry.status]}
              </span>
              <span className="font-mono text-blue-50">{entry.id}</span>
            </p>
            <p className="mt-2 text-sm text-blue-100">
              {year}/{month}: expanded from all student schedules. Lessons are included when the tutor field matches
              any of this tutor&apos;s English name / Chinese name / nickname on the Tutor page (excluding cancelled
              lessons), and only when attendance is ticked on the student schedule or room page.
            </p>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-blue-100/95">
              Subtotal rule: same date + same schedule time = same timeslot. If there is <strong>1 student</strong>,
              use the tutor <strong>Single Student Rate {rates.single}</strong>. If there are <strong>2 or more
              students</strong>, the <strong>lowest-grade student</strong> uses
              <strong> {multiStudentFirstAmount}</strong> (editable in{" "}
              <Link href="/tutor-monthly-lesson-record" className="underline hover:text-white">
                Tutor Monthly home
              </Link>{" "}
              ). Others use <strong>Junior {rates.junior}</strong> or <strong>Senior {rates.senior}</strong> by
              grade. Unrecognized grade defaults to Junior. Hours are inferred from time range; otherwise 1.5.
            </p>
          </div>

          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Link
                  href={`${base}?year=${prev.y}&month=${prev.m}`}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Previous Month
                </Link>
                <span className="text-slate-500">Year/Month</span>
                <TutorMonthlyYearMonthPicker tutorId={tutorId} year={year} month={month} />
                <Link
                  href={`${base}?year=${next.y}&month=${next.m}`}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Next Month
                </Link>
              </div>
              <div className="text-right text-xs text-slate-600">
                <p>
                  {groupedRows.length} sessions ({normalizedRowsForPay.length} student-slots)
                </p>
                {normalizedRowsForPay.length > 0 ? (
                  <p className="mt-0.5 font-semibold text-slate-800">Monthly subtotal {monthTotal}</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            {ratesMissing ? (
              <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                No record found for this tutor in latest rates. Please go to the{" "}
                <Link href="/tutor" className="font-medium text-[#1d76c2] hover:underline">
                  Tutor
                </Link>{" "}
                page and save <strong>Junior Rate, Senior Rate, and Single Student Rate</strong> so subtotals can be
                calculated correctly.
              </p>
            ) : null}
            {loadError ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {loadError}
              </p>
            ) : null}

            <div
              id="tutorMonthlyLessonRecordExport"
              className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200"
            >
              <table className="min-w-[1040px] w-full border-collapse text-sm">
                <thead className="bg-slate-50 text-left text-slate-800">
                  <tr>
                    <th className="sticky top-0 z-20 border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">{entry.displayName}</th>
                    <th className="sticky top-0 z-20 border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Date</th>
                    <th className="sticky top-0 z-20 border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Time</th>
                    <th className="sticky top-0 z-20 border border-slate-200 bg-slate-50 px-2 py-2 text-right font-semibold">Hour</th>
                    <th className="sticky top-0 z-20 border border-slate-200 bg-slate-50 px-2 py-2 text-right font-semibold">Subtotal</th>
                    <th className="sticky top-0 z-20 border border-slate-200 bg-slate-50 px-2 py-2 font-semibold">Grade</th>
                    <th className="sticky top-0 z-20 border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Student Name</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="border border-slate-200 px-4 py-8 text-center text-slate-500"
                      >
                        No lesson records matched this tutor for the selected month.
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      const totalStudentRows = groupedRows.reduce((sum, g) => sum + Math.max(g.students.length, 1), 0);
                      let renderedRows = 0;
                      return groupedRows.map((g, idx) => {
                        const prev = idx > 0 ? groupedRows[idx - 1] : null;
                        const showDate = !prev || prev.dateIso !== g.dateIso;
                        const rows = g.students.length > 0 ? g.students : [{ studentId: "", studentName: "—", grade: "—", amount: 0 }];
                        return rows.map((st, sIdx) => {
                          const isFirstGlobalRow = renderedRows === 0;
                          renderedRows += 1;
                          return (
                            <tr key={`${g.groupKey}:${st.studentId || "empty"}:${sIdx}`} className="text-slate-800">
                              {isFirstGlobalRow ? (
                                <td
                                  rowSpan={totalStudentRows}
                                  className="border border-slate-200 px-3 py-2 align-top text-slate-700"
                                >
                                  {year}
                                </td>
                              ) : null}
                              {sIdx === 0 ? (
                                <>
                                  <td rowSpan={rows.length} className="border border-slate-200 px-3 py-2 tabular-nums">
                                    {showDate ? formatMonthDay(g.dateIso) : ""}
                                  </td>
                                  <td rowSpan={rows.length} className="border border-slate-200 px-3 py-2 whitespace-nowrap tabular-nums">
                                    {formatLessonTimeRangeLine(g.time, g.hours) ?? g.time}
                                  </td>
                                  <td rowSpan={rows.length} className="border border-slate-200 px-2 py-2 text-right tabular-nums">
                                    {g.hours}
                                  </td>
                                </>
                              ) : null}
                              <td className="border border-slate-200 px-2 py-2 text-right font-medium tabular-nums">
                                {st.studentId ? st.amount : "—"}
                              </td>
                              <td className="border border-slate-200 px-2 py-2">{formatGradeDisplay(st.grade) || "—"}</td>
                              <td className="border border-slate-200 px-3 py-2">
                                {st.studentId ? (
                                  <>
                                    <Link
                                      href={`/students/${encodeURIComponent(st.studentId)}/lessons`}
                                      className="text-[#1d76c2] hover:underline"
                                    >
                                      {st.studentName}
                                    </Link>
                                  </>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          );
                        });
                      });
                    })()
                  )}
                </tbody>
                {groupedRows.length > 0 ? (
                  <tfoot>
                    <tr className="bg-slate-50 font-semibold text-slate-900">
                      <td className="border border-slate-200 px-3 py-2" />
                      <td className="border border-slate-200 px-3 py-2" />
                      <td className="border border-slate-200 px-3 py-2 text-right">
                        Total
                      </td>
                      <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{monthHourTotal}</td>
                      <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">—</td>
                      <td className="border border-slate-200 px-3 py-2" />
                      <td className="border border-slate-200 px-3 py-2" />
                    </tr>
                    <tr className="bg-slate-50 font-semibold text-slate-900">
                      <td className="border border-slate-200 px-3 py-2" />
                      <td className="border border-slate-200 px-3 py-2" />
                      <td className="border border-slate-200 px-3 py-2 text-right">Monthly Salary</td>
                      <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">—</td>
                      <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{monthTotal}</td>
                      <td className="border border-slate-200 px-3 py-2" />
                      <td className="border border-slate-200 px-3 py-2" />
                    </tr>
                    {showMpfEmployerLines ? (
                      <>
                        <tr className="bg-slate-50 font-semibold text-slate-900">
                          <td className="border border-slate-200 px-3 py-2" />
                          <td className="border border-slate-200 px-3 py-2" />
                          <td className="border border-slate-200 px-3 py-2 text-right">
                            Employer MPF Contribution (5% of Relevant Income)
                          </td>
                          <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">—</td>
                          <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">
                            {mpfEmployerAmount}
                          </td>
                          <td className="border border-slate-200 px-3 py-2" />
                          <td className="border border-slate-200 px-3 py-2" />
                        </tr>
                        <tr className="bg-slate-50 font-semibold text-slate-900">
                          <td className="border border-slate-200 px-3 py-2" />
                          <td className="border border-slate-200 px-3 py-2" />
                          <td className="border border-slate-200 px-3 py-2 text-right">
                            Monthly Salary + Employer MPF Contribution
                          </td>
                          <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">—</td>
                          <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">
                            {salaryPlusMpf}
                          </td>
                          <td className="border border-slate-200 px-3 py-2" />
                          <td className="border border-slate-200 px-3 py-2" />
                        </tr>
                      </>
                    ) : null}
                    <tr className="bg-slate-50 text-slate-900">
                      <td className="border border-slate-200 px-3 py-2" />
                      <td colSpan={6} className="border border-slate-200 px-3 py-2" />
                    </tr>
                    <tr className="bg-slate-50 text-slate-900">
                      <td className="border border-slate-200 px-3 py-2" />
                      <td colSpan={6} className="border border-slate-200 px-3 py-2">
                        Beyond Math Education Centre Limited
                      </td>
                    </tr>
                    <tr className="bg-slate-50 text-slate-900">
                      <td className="border border-slate-200 px-3 py-2" />
                      <td colSpan={6} className="border border-slate-200 px-3 py-2" />
                    </tr>
                    <tr className="bg-slate-50 text-slate-900">
                      <td className="border border-slate-200 px-3 py-2" />
                      <td colSpan={3} className="border border-slate-200 px-3 py-2">
                        Employer&apos;s Signature
                      </td>
                      <td colSpan={3} className="border border-slate-200 px-3 py-2">
                        Employee&apos;s Signature
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>
        </div>
      </div>
      {groupedRows.length > 0 ? (
        <div className="fixed right-6 bottom-20 z-50">
          <a
            href={csvHref}
            download={csvFilename}
            className="inline-flex w-36 items-center justify-center rounded-full bg-[#1d76c2] px-4 py-3 text-sm font-semibold text-white shadow-lg ring-1 ring-[#145a94] transition hover:bg-[#165f9d] hover:shadow-xl"
          >
            Download Excel
          </a>
        </div>
      ) : null}
      {groupedRows.length > 0 ? (
        <DownloadTutorMonthlyPdfButton fileName={pdfFilename} head={pdfHead} body={pdfBody} />
      ) : null}
    </div>
  );
}
