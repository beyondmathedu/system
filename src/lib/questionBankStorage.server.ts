import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export const QUESTION_BANK_PDF_BUCKET = "question-bank-original-pdfs";
export const QUESTION_BANK_IMAGE_BUCKET = "question-assets";

const REQUIRED_BUCKETS = [QUESTION_BANK_PDF_BUCKET, QUESTION_BANK_IMAGE_BUCKET] as const;

function isBucketExistsError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("already exists") || m.includes("duplicate") || m.includes("resource already exists");
}

/** Ensure question-bank Storage buckets exist (creates via service role if missing). */
export async function ensureQuestionBankStorageBuckets(sb: SupabaseClient): Promise<void> {
  const { data: existing, error: listError } = await sb.storage.listBuckets();
  if (listError) {
    throw new Error(
      `Cannot list Supabase Storage buckets (${listError.message}). Run supabase/migrations/20260817_question_bank.sql in the SQL Editor, or create buckets "${QUESTION_BANK_PDF_BUCKET}" and "${QUESTION_BANK_IMAGE_BUCKET}" manually.`,
    );
  }

  const names = new Set((existing ?? []).map((b) => b.name ?? b.id));

  for (const bucket of REQUIRED_BUCKETS) {
    if (names.has(bucket)) continue;
    const { error } = await sb.storage.createBucket(bucket, { public: false });
    if (error && !isBucketExistsError(error.message)) {
      throw new Error(
        `Storage bucket "${bucket}" not found and auto-create failed (${error.message}). In Supabase Dashboard → Storage, create a private bucket named "${bucket}", or run the bucket section of supabase/migrations/20260817_question_bank.sql.`,
      );
    }
  }
}

export function formatStorageUploadError(bucket: string, message: string): string {
  if (/bucket not found/i.test(message)) {
    return `Storage bucket "${bucket}" not found. Create it in Supabase Dashboard → Storage (private), or run supabase/migrations/20260817_question_bank.sql in the SQL Editor.`;
  }
  return message;
}
