"use client";

import { useParams } from "next/navigation";
import { parseLessonYear } from "@/lib/lessonCalendar";
import { StudentLessonsYearPage } from "../StudentLessonsYearPage";

export default function StudentLessonsDynamicYearPage() {
  const params = useParams<{ year: string }>();
  const targetYear = parseLessonYear(params?.year);

  return <StudentLessonsYearPage targetYear={targetYear} />;
}
