import { redirect } from "next/navigation";
import AppTopNav from "@/components/AppTopNav";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { getViewerContext } from "@/lib/authz";
import { formatStudentDisplayNameOrEmpty } from "@/lib/studentDisplayName";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { resolveStudentInactiveEffectiveDate } from "@/lib/studentVisibility";
import UpcomingBirthdayReminder from "./UpcomingBirthdayReminder";
import StressReliefGames from "./StressReliefGames";

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

export default async function HomeLandingPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login");
  const supabase = await createSupabaseServerClient();

  const [{ data: studentRows }, { data: tutorRows }, { data: visibilityRows }] = await Promise.all([
    supabase.from("students").select("id, name_zh, name_en, nickname_en, birth_date, grade"),
    supabase.from("tutors").select("id, name_zh, name_en, birth_date, status"),
    supabase.from("student_visibility_modes").select("student_id, mode, effective_date"),
  ]);

  const ymdToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const mdToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const year = Number(ymdToday.slice(0, 4)) || new Date().getFullYear();
  const month = Number(ymdToday.slice(5, 7)) || 1;
  const manualInactiveEffectiveById = new Map<string, string>();
  for (const row of visibilityRows ?? []) {
    const mode = String((row as any).mode ?? "").toLowerCase();
    const sid = String((row as any).student_id ?? "");
    const eff = String((row as any).effective_date ?? "");
    if (mode === "inactive" && sid && eff) manualInactiveEffectiveById.set(sid, eff);
  }

  const studentsBirthdayToday = (studentRows ?? [])
    .filter((r: any) => {
      const sid = String(r.id ?? "");
      const grade = String((r as any).grade ?? "");
      const inactiveEffective = resolveStudentInactiveEffectiveDate({
        grade,
        manualInactiveEffective: manualInactiveEffectiveById.get(sid) ?? null,
        year,
      });
      return !(inactiveEffective && inactiveEffective <= ymdToday);
    })
    .filter((r: any) => String(r.birth_date ?? "").slice(5, 10) === mdToday)
    .map((r: any) =>
      formatStudentDisplayNameOrEmpty(
        {
          id: String(r.id ?? ""),
          name_zh: r.name_zh,
          name_en: r.name_en,
          nickname_en: r.nickname_en,
        },
        "full",
        String(r.id ?? ""),
      ),
    );

  const activeStudentRows = (studentRows ?? []).filter((r: any) => {
    const sid = String(r.id ?? "");
    const grade = String((r as any).grade ?? "");
    const inactiveEffective = resolveStudentInactiveEffectiveDate({
      grade,
      manualInactiveEffective: manualInactiveEffectiveById.get(sid) ?? null,
      year,
    });
    return !(inactiveEffective && inactiveEffective <= ymdToday);
  });

  const activeStudentIds = activeStudentRows.map((r: any) => String(r.id ?? "")).filter(Boolean);

  const [{ data: feeRows }, { data: yearStateRows }] = await Promise.all([
    activeStudentIds.length
      ? supabase
          .from("student_monthly_fee_records")
          .select("student_id, submitted_amount")
          .eq("year", year)
          .eq("month", month)
          .in("student_id", activeStudentIds)
      : Promise.resolve({ data: [] as any[] }),
    activeStudentIds.length
      ? supabase
          .from("student_lessons_year_state")
          .select("student_id, attendance, reschedule_entries")
          .eq("year", year)
          .in("student_id", activeStudentIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const paidAmountByStudentId = new Map<string, number>();
  for (const row of feeRows ?? []) {
    const sid = String((row as any).student_id ?? "");
    if (!sid) continue;
    paidAmountByStudentId.set(sid, Number((row as any).submitted_amount ?? 0) || 0);
  }

  const unpaidStudents = activeStudentRows
    .filter((r: any) => (paidAmountByStudentId.get(String(r.id ?? "")) ?? 0) <= 0)
    .map((r: any) =>
      formatStudentDisplayNameOrEmpty(
        {
          id: String(r.id ?? ""),
          name_zh: r.name_zh,
          name_en: r.name_en,
          nickname_en: r.nickname_en,
        },
        "full",
        String(r.id ?? ""),
      ),
    );

  const pendingMakeupByStudentId = new Map<string, number>();
  for (const row of yearStateRows ?? []) {
    const sid = String((row as any).student_id ?? "");
    if (!sid) continue;
    const attendance = ((row as any).attendance ?? {}) as Record<string, boolean>;
    const entries = Array.isArray((row as any).reschedule_entries) ? (row as any).reschedule_entries : [];
    let pendingCount = 0;
    for (const e of entries) {
      const id = String((e as any)?.id ?? "");
      const toDate = String((e as any)?.toDate ?? "");
      if (!id || !toDate) continue;
      if (toDate > ymdToday) continue;
      if (attendance[`reschedule:${id}`] === true) continue;
      pendingCount += 1;
    }
    if (pendingCount > 0) pendingMakeupByStudentId.set(sid, pendingCount);
  }

  const studentsWithPendingMakeup = activeStudentRows
    .filter((r: any) => pendingMakeupByStudentId.has(String(r.id ?? "")))
    .map((r: any) => {
      const sid = String(r.id ?? "");
      const name = formatStudentDisplayNameOrEmpty(
        {
          id: sid,
          name_zh: r.name_zh,
          name_en: r.name_en,
          nickname_en: r.nickname_en,
        },
        "full",
        sid,
      );
      const count = pendingMakeupByStudentId.get(sid) ?? 0;
      return `${name}（${count} 堂）`;
    });

  const tutorsBirthdayToday = (tutorRows ?? [])
    .filter((r: any) => {
      const status = String(r.status ?? "").trim();
      return status === "工作中" || status === "放假中";
    })
    .filter((r: any) => String(r.birth_date ?? "").slice(5, 10) === mdToday)
    .map((r: any) => {
      const zh = String(r.name_zh ?? "").trim();
      const en = String(r.name_en ?? "").trim();
      return zh || en || String(r.id ?? "");
    });

  const birthdayLines = [
    ...studentsBirthdayToday.map((name) => `${name}（學生）`),
    ...tutorsBirthdayToday.map((name) => `${name}（導師）`),
  ];
  const birthdaySummary = birthdayLines.length ? birthdayLines.join("、") : "今日冇生日之星";
  const todayWhatsappMessage = birthdayLines.length
    ? `${birthdaySummary} 今日生日`
    : "今日沒有生日之星";
  const todayWhatsappHref = `https://wa.me/85251646814?text=${encodeURIComponent(todayWhatsappMessage)}`;

  const allBirthdayRows = [
    ...(studentRows ?? [])
      .filter((r: any) => {
        const sid = String(r.id ?? "");
        const grade = String((r as any).grade ?? "");
        const inactiveEffective = resolveStudentInactiveEffectiveDate({
          grade,
          manualInactiveEffective: manualInactiveEffectiveById.get(sid) ?? null,
          year,
        });
        return !(inactiveEffective && inactiveEffective <= ymdToday);
      })
      .map((r: any) => ({
      md: String(r.birth_date ?? "").slice(5, 10),
      label: `${formatStudentDisplayNameOrEmpty(
        {
          id: String(r.id ?? ""),
          name_zh: r.name_zh,
          name_en: r.name_en,
          nickname_en: r.nickname_en,
        },
        "full",
        String(r.id ?? ""),
      )}（學生）`,
      })),
    ...(tutorRows ?? [])
      .filter((r: any) => {
        const status = String(r.status ?? "").trim();
        return status === "工作中" || status === "放假中";
      })
      .map((r: any) => {
      const zh = String(r.name_zh ?? "").trim();
      const en = String(r.name_en ?? "").trim();
      return {
        md: String(r.birth_date ?? "").slice(5, 10),
        label: `${zh || en || String(r.id ?? "")}（導師）`,
      };
      }),
  ].filter((r) => r.md.length === 5);

  const weekBirthdayLines: string[] = [];
  const weekBirthdayReminderItems: Array<{
    id: string;
    dayLabel: string;
    dateLabel: string;
    personLabel: string;
  }> = [];
  const hkTodayDate = new Date(`${ymdToday}T00:00:00+08:00`);
  const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];
  for (let offset = 1; offset <= 7; offset += 1) {
    const d = new Date(hkTodayDate);
    d.setDate(d.getDate() + offset);
    const md = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const names = allBirthdayRows.filter((r) => r.md === md).map((r) => r.label);
    if (!names.length) continue;
    const dayName = weekdayNames[d.getDay()];
    const dateLabel = `${d.getDate()}/${d.getMonth() + 1}`;
    const dayLabel = offset === 1 ? "明天" : offset === 2 ? "後天" : `星期${dayName}`;
    weekBirthdayLines.push(`星期${dayName} ${dateLabel}：${names.join("、")}`);
    for (const name of names) {
      weekBirthdayReminderItems.push({
        id: `${md}-${name}`,
        dayLabel,
        dateLabel,
        personLabel: name,
      });
    }
    if (d.getDay() === 0) break;
  }

  const randomLine = stripPunctuation(
    CANTONESE_POSITIVE_LINES[Math.floor(Math.random() * CANTONESE_POSITIVE_LINES.length)],
  );

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="dashboard" />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-10 text-center text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              <span className="mr-2" aria-hidden>
                👋
              </span>
              Welcome!
            </h1>
            <p className="mt-2 text-sm text-blue-100 sm:text-base">
              {randomLine}
            </p>
          </div>

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

          <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5">
              <h2 className="text-base font-bold text-rose-900">未交學費學生（{month}月）</h2>
              {unpaidStudents.length ? (
                <ul className="mt-3 space-y-1 text-sm text-rose-900">
                  {unpaidStudents.map((name) => (
                    <li key={name}>- {name}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-rose-700">暫時全部已交學費</p>
              )}
            </section>

            <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
              <h2 className="text-base font-bold text-amber-900">未完成補堂學生</h2>
              {studentsWithPendingMakeup.length ? (
                <ul className="mt-3 space-y-1 text-sm text-amber-900">
                  {studentsWithPendingMakeup.map((line) => (
                    <li key={line}>- {line}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-amber-700">暫時冇未完成補堂</p>
              )}
            </section>
          </div>
        </div>

        <StressReliefGames />
      </div>
    </div>
  );
}

