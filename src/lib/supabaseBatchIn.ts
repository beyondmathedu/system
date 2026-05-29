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
  /** Number of chunks to run concurrently (default 4). */
  concurrency?: number;
  query: (chunkIds: string[]) => PromiseLike<{ data: TRow[] | null; error: { message: string } | null }>;
}): Promise<{ data: TRow[]; error: string | null }> {
  const { ids, query, chunkSize = SUPABASE_IN_CHUNK_SIZE } = params;
  const concurrency = Math.min(12, Math.max(1, Math.floor(params.concurrency ?? 4)));
  if (!ids.length) return { data: [], error: null };

  const chunks = chunkIds(ids, chunkSize);
  const merged: TRow[] = [];
  let idx = 0;

  async function worker(): Promise<{ ok: true } | { ok: false; error: string }> {
    while (idx < chunks.length) {
      const my = idx;
      idx += 1;
      const { data, error } = await query(chunks[my]);
      if (error) return { ok: false, error: error.message };
      if (data?.length) merged.push(...data);
    }
    return { ok: true };
  }

  const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker());
  const results = await Promise.all(workers);
  const failed = results.find((r): r is { ok: false; error: string } => !r.ok);
  if (failed) return { data: [], error: failed.error };
  return { data: merged, error: null };
}
