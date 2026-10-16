import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  F6_MOCK_SET_OPTIONS,
  F6_MOCK_YEAR_OPTIONS,
  normalizeMockSetLabels,
  normalizeMockYearLabels,
} from "@/lib/studentProgressMockSets";

function isMissingTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    (m.includes("app_progress_mock_sets") && (m.includes("could not find") || m.includes("not found")))
  );
}

export async function loadProgressMockSets(): Promise<{
  labels: string[];
  years: string[];
  tableMissing?: boolean;
  error?: string;
}> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("app_progress_mock_sets")
    .select("labels, years")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    const missingYearsColumn = error.message.toLowerCase().includes("years");
    if (missingYearsColumn) {
      const labelsOnly = await supabase
        .from("app_progress_mock_sets")
        .select("labels")
        .eq("id", 1)
        .maybeSingle();
      if (!labelsOnly.error) {
        const labels = normalizeMockSetLabels((labelsOnly.data as { labels?: unknown } | null)?.labels);
        return {
          labels: labels.length ? labels : [...F6_MOCK_SET_OPTIONS],
          years: [...F6_MOCK_YEAR_OPTIONS],
        };
      }
    }
    return {
      labels: [...F6_MOCK_SET_OPTIONS],
      years: [...F6_MOCK_YEAR_OPTIONS],
      tableMissing: isMissingTableError(error.message),
      error: error.message,
    };
  }
  const row = data as { labels?: unknown; years?: unknown } | null;
  const labels = normalizeMockSetLabels(row?.labels);
  const years = normalizeMockYearLabels(row?.years);
  return {
    labels: labels.length ? labels : [...F6_MOCK_SET_OPTIONS],
    years: years.length ? years : [...F6_MOCK_YEAR_OPTIONS],
  };
}

export async function saveProgressMockSets(labels: string[]): Promise<{
  ok: boolean;
  labels?: string[];
  error?: string;
  tableMissing?: boolean;
}> {
  const next = normalizeMockSetLabels(labels);
  if (!next.length) {
    return { ok: false, error: "At least one set is required" };
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("app_progress_mock_sets").upsert(
    {
      id: 1,
      labels: next,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    return {
      ok: false,
      error: error.message,
      tableMissing: isMissingTableError(error.message),
    };
  }
  return { ok: true, labels: next };
}

export async function saveProgressMockYears(years: string[]): Promise<{
  ok: boolean;
  years?: string[];
  error?: string;
  tableMissing?: boolean;
}> {
  const next = normalizeMockYearLabels(years);
  if (!next.length) {
    return { ok: false, error: "At least one year is required" };
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("app_progress_mock_sets").upsert(
    {
      id: 1,
      years: next,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    return {
      ok: false,
      error: error.message,
      tableMissing: isMissingTableError(error.message) || error.message.toLowerCase().includes("years"),
    };
  }
  return { ok: true, years: next };
}
