import { inferGradeOnDate } from "@/lib/inferStudentGrade";
import {
  isStudentInactiveOnDate,
  isStudentInactiveOnDateFromPeriods,
  resolveStudentInactiveEffectiveDate,
  withAutoF6InactivePeriod,
  type StudentInactivePeriod,
} from "@/lib/studentVisibility";

type StudentLike = { id: string; grade?: string | null };

/** Active on a specific calendar day (YYYY-MM-DD). */
export function filterActiveStudentsOnDate<T extends StudentLike>(
  students: T[],
  manualInactiveEffectiveById:
    | Map<string, string>
    | Record<string, string>
    | Map<string, StudentInactivePeriod[]>
    | Record<string, StudentInactivePeriod[]>,
  year: number,
  dateIso: string,
  reactivateDateById?: Map<string, string | null> | Record<string, string | null>,
): T[] {
  const anyValue = manualInactiveEffectiveById instanceof Map
    ? manualInactiveEffectiveById.values().next().value
    : Object.values(manualInactiveEffectiveById ?? {})[0];
  const periodsMode = Array.isArray(anyValue);
  if (periodsMode) {
    const periodsMap =
      manualInactiveEffectiveById instanceof Map
        ? (manualInactiveEffectiveById as Map<string, StudentInactivePeriod[]>)
        : new Map(Object.entries(manualInactiveEffectiveById as Record<string, StudentInactivePeriod[]>));
    const y = Number(String(dateIso ?? "").slice(0, 4)) || year;
    return students.filter((st) => {
      const periods = withAutoF6InactivePeriod({
        periods: periodsMap.get(st.id) ?? [],
        studentId: st.id,
        grade: inferGradeOnDate(st.grade ?? "", dateIso),
        year: y,
      });
      return !isStudentInactiveOnDateFromPeriods({ periods, dateIso });
    });
  }

  const manualMap =
    manualInactiveEffectiveById instanceof Map
      ? (manualInactiveEffectiveById as Map<string, string>)
      : new Map(Object.entries(manualInactiveEffectiveById as Record<string, string>));
  const reactivateMap =
    reactivateDateById instanceof Map
      ? reactivateDateById
      : new Map(Object.entries(reactivateDateById ?? {}));

  return students.filter((st) => {
    return !isStudentInactiveOnDate({
      grade: st.grade,
      manualInactiveEffective: manualMap.get(st.id) ?? null,
      reactivateDate: reactivateMap.get(st.id) ?? null,
      year,
      dateIso,
    });
  });
}

/**
 * Still has at least one active day in the calendar year (inactive from YYYY-01-01 onward → skip).
 */
export function filterStudentsWithAnyActivityInYear<T extends StudentLike>(
  students: T[],
  manualInactiveEffectiveById:
    | Map<string, string>
    | Record<string, string>
    | Map<string, StudentInactivePeriod[]>
    | Record<string, StudentInactivePeriod[]>,
  year: number,
): T[] {
  const yearStart = `${year}-01-01`;
  const yearEndExclusive = `${year + 1}-01-01`;
  const anyValue = manualInactiveEffectiveById instanceof Map
    ? manualInactiveEffectiveById.values().next().value
    : Object.values(manualInactiveEffectiveById ?? {})[0];
  const periodsMode = Array.isArray(anyValue);
  if (periodsMode) {
    const periodsMap =
      manualInactiveEffectiveById instanceof Map
        ? (manualInactiveEffectiveById as Map<string, StudentInactivePeriod[]>)
        : new Map(Object.entries(manualInactiveEffectiveById as Record<string, StudentInactivePeriod[]>));
    return students.filter((st) => {
      const periods = withAutoF6InactivePeriod({
        periods: periodsMap.get(st.id) ?? [],
        studentId: st.id,
        grade: st.grade,
        year,
      });
      // Skip only if the student is inactive for the entire year.
      for (const p of periods) {
        const end = p.endDate ?? "9999-12-31";
        if (p.startDate <= yearStart && end >= yearEndExclusive) return false;
      }
      return true;
    });
  }

  const manualMap =
    manualInactiveEffectiveById instanceof Map
      ? (manualInactiveEffectiveById as Map<string, string>)
      : new Map(Object.entries(manualInactiveEffectiveById as Record<string, string>));

  return students.filter((st) => {
    const inactiveEffective = resolveStudentInactiveEffectiveDate({
      grade: st.grade,
      manualInactiveEffective: manualMap.get(st.id) ?? null,
      year,
    });
    return !(inactiveEffective && inactiveEffective <= yearStart);
  });
}

export function studentIdsOf<T extends StudentLike>(students: T[]): string[] {
  return students.map((s) => s.id).filter(Boolean);
}
