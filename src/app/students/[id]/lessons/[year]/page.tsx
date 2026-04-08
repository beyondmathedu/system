"use client";

import { useParams } from "next/navigation";
import { StudentLessonsYearPage } from "../2026/page";

export default function StudentLessonsDynamicYearPage() {
  const params = useParams<{ year: string }>();
  const parsedYear = Number(params?.year || "");
  const targetYear =
    Number.isFinite(parsedYear) && parsedYear >= 2026 && parsedYear <= 2099
      ? parsedYear
      : 2026;

  return <StudentLessonsYearPage targetYear={targetYear} />;
}
