import type { StudentLessonsBootstrapPayload } from "@/lib/lessonDataServer";
import { readYmdParts } from "@/lib/intlFormatParts";
import { normalizeRescheduleEntriesForSchedule } from "@/lib/rescheduleEntryNormalize";
import type { RoomSlotTutorRule } from "@/lib/roomSlotTutorRules";

type ScheduleRecord = {
  id: string;
  effectiveDate?: string;
  weekday: string;
  time: string;
  room: string;
  tutor?: string;
  lessonSummary?: string;
  lessonType?: string;
  createdAt: number;
};

type DayOverride = {
  time?: string;
  room?: string;
  tutor?: string;
  lessonSummary?: string;
  lessonType?: string;
};

type RescheduleEntry = {
  id: string;
  fromDate: string;
  toDate: string;
  time: string;
  room: string;
  pending?: boolean;
  fromScheduleRuleId?: string;
  fromTime?: string;
  fromRoom?: string;
};

type ExtraEntry = {
  id: string;
  date: string;
  time: string;
  room: string;
  originDate?: string;
  originTime?: string;
  originRoom?: string;
  pending?: boolean;
};

export type StudentInactivePeriodRowHydrated = {
  student_id: string;
  start_date: string;
  end_date: string | null;
  note: string;
};

export type HydratedLessonYearBootstrap = {
  studentSummary: {
    id: string;
    nameZh: string;
    nameEn: string;
    nicknameEn: string;
    grade: string;
    school: string;
    textbookPublisher: string;
  };
  examInfo: { examDate: string; examContent: string };
  visibilityMode: "active" | "inactive";
  visibilityEffectiveDate: string;
  visibilityReactivateDate: string | null;
  inactivePeriods: StudentInactivePeriodRowHydrated[];
  records: ScheduleRecord[];
  roomSlotTutorRules: RoomSlotTutorRule[];
  attendance: Record<string, boolean>;
  hiddenDates: Record<string, boolean>;
  overrides: Record<string, DayOverride>;
  rescheduleEntries: RescheduleEntry[];
  extraEntries: ExtraEntry[];
  studentLoaded: boolean;
  studentNotFound: boolean;
};

function toHkIsoDateFromMs(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));

  const { y, m, d } = readYmdParts(parts);
  return `${y}-${m}-${d}`;
}

function normalizeScheduleRecords(raw: unknown): ScheduleRecord[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  return (raw as ScheduleRecord[]).map((r) => ({
    ...r,
    effectiveDate: r.effectiveDate ?? toHkIsoDateFromMs(r.createdAt),
  }));
}

/** Pure bootstrap → client state for SSR / first paint (no localStorage). */
export function hydrateLessonYearFromBootstrap(
  bootstrap: StudentLessonsBootstrapPayload,
  studentId: string,
  targetYear: number,
): HydratedLessonYearBootstrap {
  const data = bootstrap.student;
  if (!data) {
    return {
      studentSummary: {
        id: studentId,
        nameZh: "",
        nameEn: "",
        nicknameEn: "",
        grade: "",
        school: "",
        textbookPublisher: "",
      },
      examInfo: {
        examDate: bootstrap.examInfo?.examDate ?? "",
        examContent: bootstrap.examInfo?.examContent ?? "",
      },
      visibilityMode: "active",
      visibilityEffectiveDate: "",
      visibilityReactivateDate: null,
      inactivePeriods: [],
      records: [],
      roomSlotTutorRules: Array.isArray(bootstrap.roomSlotTutorRules)
        ? bootstrap.roomSlotTutorRules
        : [],
      attendance: {},
      hiddenDates: {},
      overrides: {},
      rescheduleEntries: [],
      extraEntries: [],
      studentLoaded: true,
      studentNotFound: true,
    };
  }

  const vis = bootstrap.visibilityMode;
  const rawVisMode = String(vis?.mode ?? "active").toLowerCase();
  const records = normalizeScheduleRecords(bootstrap.scheduleRecords);
  const cloud = bootstrap.yearState;
  const hiddenDates = (cloud?.hiddenDates ?? {}) as Record<string, boolean>;
  const overrides = (cloud?.overrides ?? {}) as Record<string, DayOverride>;
  const normalizedReschedule = normalizeRescheduleEntriesForSchedule(
    (cloud?.rescheduleEntries ?? []) as RescheduleEntry[],
    records as import("@/lib/yearScheduleCore").YearLessonRecord[],
    hiddenDates,
    overrides,
    targetYear,
  );

  return {
    studentSummary: {
      id: data.id,
      nameZh: data.name_zh ?? "",
      nameEn: data.name_en ?? "",
      nicknameEn: data.nickname_en ?? "",
      grade: data.grade ?? "",
      school: data.school ?? "",
      textbookPublisher: data.textbook_publisher ?? "",
    },
    examInfo: {
      examDate: bootstrap.examInfo?.examDate ?? "",
      examContent: bootstrap.examInfo?.examContent ?? "",
    },
    visibilityMode: rawVisMode === "inactive" ? "inactive" : "active",
    visibilityEffectiveDate: String(vis?.effective_date ?? ""),
    visibilityReactivateDate:
      typeof vis?.reactivate_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(vis.reactivate_date)
        ? vis.reactivate_date
        : null,
    inactivePeriods: Array.isArray(bootstrap.inactivePeriods)
      ? bootstrap.inactivePeriods.map((row) => ({
          student_id: String(row.student_id ?? studentId),
          start_date: String(row.start_date ?? ""),
          end_date:
            typeof row.end_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.end_date)
              ? row.end_date
              : null,
          note: String(row.note ?? ""),
        }))
      : [],
    records,
    roomSlotTutorRules: Array.isArray(bootstrap.roomSlotTutorRules) ? bootstrap.roomSlotTutorRules : [],
    attendance: (cloud?.attendance ?? {}) as Record<string, boolean>,
    hiddenDates,
    overrides,
    rescheduleEntries: normalizedReschedule,
    extraEntries: (cloud?.extraEntries ?? []) as ExtraEntry[],
    studentLoaded: true,
    studentNotFound: false,
  };
}
