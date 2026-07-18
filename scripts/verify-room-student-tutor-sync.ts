/**
 * Verify: room-page tutor override → student schedule row tutor for every student/date.
 * Run: npx tsx scripts/verify-room-student-tutor-sync.ts
 */
import { createClient } from "@supabase/supabase-js";
import { buildYearScheduleRowsForMonth } from "../src/lib/yearScheduleCore";
import { buildStudentScheduleRows } from "../src/lib/studentScheduleRowMapper";
import {
  loadRoomSlotTutorRulesServer,
  resolveRoomSlotTutorForLessonRow,
} from "../src/lib/roomSlotTutorRules";

const YEAR = 2026;
const MONTHS = [5, 6, 7, 8, 9, 10, 11, 12];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const sb = createClient(url, key);
  const rules = await loadRoomSlotTutorRulesServer(sb);
  const [{ data: states }, { data: recRows }] = await Promise.all([
    sb.from("student_lessons_year_state").select("student_id, overrides").eq("year", YEAR),
    sb.from("student_lesson_records").select("student_id, records"),
  ]);
  const recMap = new Map((recRows ?? []).map((r) => [String(r.student_id), r.records ?? []]));

  let roomStudentMismatch = 0;
  let samples: string[] = [];

  for (const st of states ?? []) {
    const sid = String(st.student_id);
    const overrides = (st.overrides ?? {}) as Record<string, { tutor?: string }>;
    const records = (recMap.get(sid) ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      effectiveDate: String(r.effectiveDate ?? "2026-05-01"),
      weekday: String(r.weekday ?? ""),
      time: String(r.time ?? ""),
      room: String(r.room ?? ""),
      createdAt: Number(r.createdAt) > 0 ? Number(r.createdAt) : 1,
    }));

    const mapperState = {
      hiddenDates: {},
      overrides,
      rescheduleEntries: [],
      extraEntries: [],
    };
    const yearState = { ...mapperState, attendance: {} };

    for (const month of MONTHS) {
      const roomRows = buildYearScheduleRowsForMonth(records, yearState, YEAR, month, {
        roomSlotTutorRules: rules,
      });
      const studentRows = buildStudentScheduleRows(
        records,
        mapperState,
        YEAR,
        "2026-07-17",
        { month, roomSlotTutorRules: rules },
      );

      const studentByKey = new Map(
        studentRows.map((r) => [`${r.date}|${r.time}|${r.room}`, r.tutor.trim()]),
      );

      for (const row of roomRows) {
        if (row.lessonType === "取消") continue;
        const key = `${row.date}|${row.time}|${row.room}`;
        const roomTutor = row.tutorDisplay.trim();
        const studentTutor = studentByKey.get(key) ?? "";
        if (roomTutor !== studentTutor) {
          roomStudentMismatch++;
          if (samples.length < 10) {
            samples.push(
              `${sid} ${row.date} ${row.room} ${row.time} room=${roomTutor || "—"} student=${studentTutor || "—"}`,
            );
          }
        }
      }
    }
  }

  console.log("Room ↔ student tutor display mismatches:", roomStudentMismatch);
  if (samples.length) {
    console.log("Samples:");
    for (const s of samples) console.log(" ", s);
  } else {
    console.log("OK: room aggregate and student page use the same tutor for every date.");
  }

  console.log("\nFlow when you change tutor on room page:");
  console.log("  1. Saves overrides[that-date].tutor for each student in that slot");
  console.log("  2. Student page reads the same overrides → that date’s Tutor column updates");
  console.log("  3. Realtime + tab focus refresh keep student page in sync");
}

void main();
