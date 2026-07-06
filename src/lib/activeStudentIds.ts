import { isStudentInactiveOnDate, resolveStudentInactiveEffectiveDate } from "@/lib/studentVisibility";

type StudentLike = { id: string; grade?: string | null };

/** Active on a specific calendar day (YYYY-MM-DD). */
export function filterActiveStudentsOnDate<T extends StudentLike>(
  students: T[],
  manualInactiveEffectiveById: Map<string, string> | Record<string, string>,
  year: number,
  dateIso: string,
  reactivateDateById?: Map<string, string | null> | Record<string, string | null>,
): T[] {
  const manualMap =
    manualInactiveEffectiveById instanceof Map
      ? manualInactiveEffectiveById
      : new Map(Object.entries(manualInactiveEffectiveById));
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
  manualInactiveEffectiveById: Map<string, string> | Record<string, string>,
  year: number,
): T[] {
  const yearStart = `${year}-01-01`;
  const manualMap =
    manualInactiveEffectiveById instanceof Map
      ? manualInactiveEffectiveById
      : new Map(Object.entries(manualInactiveEffectiveById));

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
