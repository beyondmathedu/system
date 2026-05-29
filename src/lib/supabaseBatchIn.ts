/** PostgREST `.in()` lists are capped; keep chunks small for reliability. */
export const SUPABASE_IN_CHUNK_SIZE = 80;

export function chunkIds<T>(ids: readonly T[], chunkSize = SUPABASE_IN_CHUNK_SIZE): T[][] {
  if (!ids.length) return [];
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    out.push(ids.slice(i, i + chunkSize) as T[]);
  }
  return out;
}

/** Run the same select with `.in(column, chunk)` and merge row arrays. */
export async function fetchRowsInChunks<TRow>(params: {
  ids: string[];
  chunkSize?: number;
  query: (chunkIds: string[]) => PromiseLike<{ data: TRow[] | null; error: { message: string } | null }>;
}): Promise<{ data: TRow[]; error: string | null }> {
  const { ids, query, chunkSize = SUPABASE_IN_CHUNK_SIZE } = params;
  if (!ids.length) return { data: [], error: null };

  const merged: TRow[] = [];
  for (const chunk of chunkIds(ids, chunkSize)) {
    const { data, error } = await query(chunk);
    if (error) return { data: [], error: error.message };
    if (data?.length) merged.push(...data);
  }
  return { data: merged, error: null };
}
