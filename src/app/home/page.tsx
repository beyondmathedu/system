import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import AppTopNav from "@/components/AppTopNav";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { redirectTutorAwayFromAdminPages } from "@/lib/requireTutorRoomOnly";
import { redirectStudentAwayFromAdminPages } from "@/lib/studentPortalAccess";
import { redirectIfInactiveStudentPortalBlocked } from "@/lib/studentPortalAccess.server";
import { fetchHomeDashboardData } from "@/lib/homeDashboardData";
import { PENDING_MAKEUP_BUTTON_LABEL_ZH } from "@/lib/pendingMakeup";
import HomeReminderPanel from "./HomeReminderPanel";
import UpcomingBirthdayReminder from "./UpcomingBirthdayReminder";

const CANTONESE_POSITIVE_LINES = [
  "今日都會順順利利。",
  "慢慢嚟，一樣做得到。",
  "一步一步，愈做愈順。",
  "今日會係好好嘅一日。",
  "唔使急，跟住節奏就得。",
  "做咗就有進度，繼續加油。",
  "專注當下，其他交俾時間。",
  "穩穩陣陣，最緊要。",
  "辛苦咗，記得飲啖水。",
  "今日你已經好努力。",
  "唔完美都可以好好。",
  "一步細細行，都係向前。",
  "有進展就值得開心。",
  "做得到嘅，慢慢做。",
  "唔順利都唔代表失敗。",
  "你嘅節奏，就係最好嘅節奏。",
  "心急食唔到熱豆腐，慢慢嚟。",
  "先做最重要嗰樣。",
  "今日做少少，都係做到。",
  "辛苦咗，休息下再嚟。",
  "你已經比昨日更進步。",
  "遇到難題，先深呼吸。",
  "凡事有得拆開做。",
  "小步快跑，一樣有效。",
  "慢慢累積，就會變厲害。",
  "你而家做緊嘅，會有回報。",
  "唔洗同人比，同自己比就得。",
  "做完一件，就係一件。",
  "今日保持清醒就贏。",
  "保持節奏，唔好硬撐。",
  "你嘅努力有人見到。",
  "有問題就問，唔係弱。",
  "完成比完美更重要。",
  "先開始，就成功一半。",
  "一步到位唔常有，慢慢到位先穩。",
  "做少少，勝過諗好耐。",
  "今日專心一點點就夠。",
  "唔好急，慢慢調整。",
  "你已經行咗好遠。",
  "遇到阻滯，轉個方法就得。",
  "做緊就會有路。",
  "撐住，快過喇。",
  "你值得被溫柔對待。",
  "你嘅心力好珍貴。",
  "先照顧好自己。",
  "今日唔順，聽日再嚟。",
  "保持簡單，效率更高。",
  "慢慢做，都會做完。",
  "有得揀就揀舒服嘅做法。",
  "做完再優化，唔使一開始就完美。",
  "你嘅專注會帶你去到目標。",
  "一步一步嚟，唔會走失。",
  "你做緊嘅，係重要嘅事。",
  "今日先把最難嗰啲搞掂。",
  "你嘅努力唔會白費。",
  "有得改善就好，唔洗自責。",
  "唔明就問，學得更快。",
  "今日先完成，聽日再更好。",
  "你已經比想像中堅強。",
  "慢慢嚟，條路會開。",
  "遇到困難，代表你喺成長。",
  "一日一小步，幾日就一大步。",
  "先做再調整，最有效。",
  "保持清晰，先有方向。",
  "今日唔洗做晒，做啱就得。",
  "一件一件嚟，唔洗一口氣。",
  "你唔係一個人。",
  "你嘅耐性好值錢。",
  "今日先把基本做好。",
  "做得穩，先走得遠。",
  "你已經做緊最啱嘅選擇。",
  "開始咗就唔好停太耐。",
  "停一停，先行得更快。",
  "你值得為自己鼓掌。",
  "今日都可以有好心情。",
  "唔好怕慢，最怕停。",
  "做完之後你會更輕鬆。",
  "你嘅努力會累積成實力。",
  "保持規律，會更順。",
  "你有能力處理好。",
  "今日先處理最緊要嘅。",
  "你做到嘅，比你想像更多。",
  "唔順手就換個順手方法。",
  "你嘅專心係一種超能力。",
  "先收拾好心情，再做事。",
  "今日先把事情簡化。",
  "你嘅付出會被記住。",
  "你已經好接近目標。",
  "慢慢嚟，唔洗同人爭。",
  "做得好唔好，都值得肯定。",
  "你而家做緊嘅，好重要。",
  "今日先把待辦清一格。",
  "你嘅每一步都算數。",
  "唔好內耗，向前就得。",
  "留返力氣俾重要嘅事。",
  "你可以信自己。",
  "先完成，再變好。",
  "你嘅想法好有價值。",
  "今日會越做越順。",
  "做啱方向，比做快重要。",
  "今日先把雜事放低。",
  "你已經好醒目。",
  "有壓力好正常，你做緊大事。",
  "你嘅努力會有人支持。",
  "慢慢嚟，先穩後快。",
  "今日先做一個好決定。",
  "你嘅堅持好有力量。",
  "你會愈嚟愈熟手。",
  "你已經做得好好。",
] as const;

function stripPunctuation(input: string) {
  return input
    .replace(/[。．\.!！\?？/]/g, "")
    .replace(/[，、,:：;；"“”'‘’（）\(\)\[\]\{\}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dailyPositiveLine(seed: string) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const index = hash % CANTONESE_POSITIVE_LINES.length;
  return stripPunctuation(CANTONESE_POSITIVE_LINES[index]);
}

export default async function HomeLandingPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login");
  redirectTutorAwayFromAdminPages(viewer);
  if (viewer.role === "student") {
    await redirectIfInactiveStudentPortalBlocked(viewer);
  }
  redirectStudentAwayFromAdminPages(viewer);
  const navViewer = await buildAppTopNavViewer(viewer);
  const ymdToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const randomLine = dailyPositiveLine(ymdToday);

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="dashboard" viewer={navViewer} />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-10 text-center text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              <span className="mr-2" aria-hidden>
                👋
              </span>
              歡迎！
            </h1>
            <p className="mt-2 text-sm text-blue-100 sm:text-base">{randomLine}</p>
          </div>

          <Suspense fallback={<HomeDashboardSkeleton />}>
            <HomeDashboardBody />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function HomeDashboardSkeleton() {
  return (
    <div className="space-y-4 p-6" aria-busy="true">
      <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-40 animate-pulse rounded-lg bg-slate-100" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-48 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-48 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-48 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <p className="sr-only">Loading dashboard…</p>
    </div>
  );
}

async function HomeDashboardBody() {
  const dashboard = await fetchHomeDashboardData();
  const {
    ymdToday,
    month,
    birthdaySummary,
    todayWhatsappHref,
    weekBirthdayLines,
    weekBirthdayReminderItems,
    unpaidRows,
    reschedulePendingRows,
    pendingLeaveRows,
    inactiveReturnRows,
    priorMakeupMonthLabel,
    isMonthEndMakeupReminder,
    daysLeftInMonth,
  } = dashboard;

  return (
    <>
          <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <section className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">
                  <span className="mr-1" aria-hidden>
                    🎂
                  </span>
                  今日生日之星
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="text-sm text-slate-600">{birthdaySummary}</p>
                  <a
                    href={todayWhatsappHref}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
                  >
                    WhatsApp 提醒 51646814
                  </a>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">
                  <span className="mr-1" aria-hidden>
                    🎂
                  </span>
                  本週生日之星（明天～星期日）
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {weekBirthdayLines.length ? weekBirthdayLines.join(" ｜ ") : "本週暫時冇生日提醒"}
                </p>
                <UpcomingBirthdayReminder items={weekBirthdayReminderItems} />
              </section>
            </div>
          </div>

          <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
            <section
              className={`rounded-xl border px-4 py-4 ${
                isMonthEndMakeupReminder
                  ? "border-amber-300 bg-amber-50"
                  : "border-slate-200 bg-white"
              }`}
            >
              <p
                className={`text-sm font-bold ${
                  isMonthEndMakeupReminder ? "text-amber-950" : "text-slate-800"
                }`}
              >
                <span className="mr-1" aria-hidden>
                  📋
                </span>
                首頁待辦說明（{month} 月 · 香港時間 {ymdToday}）
              </p>
              <div className="mt-3 grid gap-3 text-xs leading-relaxed text-slate-700 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="font-semibold text-slate-800">A. 上月恆常課未打勾</p>
                  <p className="mt-1">
                    指 <span className="font-medium">{priorMakeupMonthLabel}</span>
                    仍缺席、未在課表打勾的恆常堂（與學費頁 Makeup 欄一致）。請到學費頁逐日核對。
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="font-semibold text-slate-800">B. 已排補堂但未打勾</p>
                  <p className="mt-1">
                    已在課表用 Reschedule 填好補堂日，且補堂日 ≤ 今天，但補堂列仍未打勾。見下方琥珀色列表
                    {reschedulePendingRows.length > 0
                      ? `（目前 ${reschedulePendingRows.length} 人）`
                      : ""}
                    。
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 sm:col-span-2">
                  <p className="font-semibold text-slate-800">C. {PENDING_MAKEUP_BUTTON_LABEL_ZH}</p>
                  <p className="mt-1">
                    只在課表記了原課日、新日留空（按「{PENDING_MAKEUP_BUTTON_LABEL_ZH}」）。以原課日所在月
                    M 計：可補至 M+1 月底（例：5 月請假 → 可補至 6 月底）；由 M+2 月 1 日起不可再改（例：7
                    月 1 日起），顯示「已過補堂限期」；M+3 月 1 日起列表／課表不再顯示（例：8
                    月起）。與 A、B 不同，唔會計入 B 列表。
                  </p>
                </div>
              </div>
              {isMonthEndMakeupReminder ? (
                <p className="mt-3 text-sm font-medium text-amber-900">
                  月尾提醒：本月尚餘 {daysLeftInMonth === 0 ? "最後一日" : `${daysLeftInMonth + 1} 日`}，請盡快處理 A、B、C。
                </p>
              ) : null}
              <Link
                href="/students-lesson-time-fee-record"
                className="mt-3 inline-flex rounded-md border border-[#1d76c2]/30 bg-[#1d76c2]/5 px-3 py-1.5 text-xs font-semibold text-[#1d76c2] hover:bg-[#1d76c2]/10"
              >
                學費頁（Makeup 欄 · Zoho Tuition Paid）→
              </Link>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-2">
            <HomeReminderPanel
              title={`未交學費（${month} 月）· ${unpaidRows.length} 人`}
              titleClassName="text-rose-900"
              borderClassName="border-rose-200"
              bgClassName="bg-rose-50/60"
              logicTitle="點解會出現？"
              logicLines={[
                "讀取 student_monthly_fee_records 當月 submitted_amount。",
                "≤ $0 視為未交（含未填、Zoho 未同步）。",
                "Zoho 同步：只計 F.1–F.6 / Math Course 課程行；Total HKD → Tuition Paid，quantity → 括號堂數（文具等不計）。",
              ]}
              rows={unpaidRows}
              emptyTitle="本月全部已有 Tuition Paid 紀錄"
              footerLink={{
                href: "/students-lesson-time-fee-record",
                label: "開啟學費紀錄表 →",
              }}
            />

            <HomeReminderPanel
              title={`已排補堂未打勾 · ${reschedulePendingRows.length} 人`}
              titleClassName="text-amber-900"
              borderClassName="border-amber-200"
              bgClassName="bg-amber-50/70"
              logicTitle="點解會出現？（≠ 上月 Makeup 未打勾）"
              logicLines={[
                "reschedule_entries 已有補堂日 toDate，且 toDate ≤ 今天。",
                "attendance「reschedule:ID」仍未打勾。",
                "補堂日係未來的唔會列出；請假待定（無 toDate）亦唔會列出。",
              ]}
              rows={reschedulePendingRows}
              emptyTitle="暫時冇已過期未打勾的補堂"
              emptyHint="若上月恆常課未打勾，請用學費頁 Makeup 欄，唔係此列表。"
              footerLink={{
                href: "/students-lesson-time-fee-record",
                label: "學費頁 Makeup 欄（上月恆常未打勾）→",
              }}
            />

            <HomeReminderPanel
              title={`${PENDING_MAKEUP_BUTTON_LABEL_ZH} · ${pendingLeaveRows.length} 筆`}
              titleClassName="text-orange-950"
              borderClassName="border-orange-200"
              bgClassName="bg-orange-50/80"
              logicTitle="點樣建立？"
              logicLines={[
                `學生課表 2026 → 勾選恆常課 →「${PENDING_MAKEUP_BUTTON_LABEL_ZH}」。`,
                "只記原課日；新日留空；pending 存入 reschedule_entries。",
                "確定補堂日後改用 Reschedule 填新日期（會離開此列表）。",
                "原課月 M：可補至 M+1 月底；M+2 起不可改；M+3 起此列表唔再顯示。",
              ]}
              rows={pendingLeaveRows}
              emptyTitle={`目前沒有 ${PENDING_MAKEUP_BUTTON_LABEL_ZH}`}
              emptyHint="有學生請假但補堂日未定時，在課表用上方按鈕登記，就會出現在此。"
            />

            <HomeReminderPanel
              title={`Inactive 預計復課 · ${inactiveReturnRows.length} 人`}
              titleClassName="text-violet-900"
              borderClassName="border-violet-200"
              bgClassName="bg-violet-50/70"
              logicTitle="點樣設定？"
              logicLines={[
                "學生 Lessons 頁 → Student Mode 設 Inactive + 生效日。",
                "選填「預計復課日」；Inactive 期間唔顯示於日課表、Room、學費表。",
                "到復課日請改回 Active 並確認課表。",
              ]}
              rows={inactiveReturnRows}
              emptyTitle="暫時冇 Inactive 復課提醒"
              emptyHint="暫停上堂而知道幾時返嚟，可填預計復課日。"
            />
          </div>
    </>
  );
}

