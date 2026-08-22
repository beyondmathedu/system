import "server-only";

/** Turn PostgREST schema-cache errors into actionable setup hints. */
export function formatQuestionBankDbError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("schema cache") && m.includes("status") && m.includes("question_pdf_sources")) {
    return (
      "Database schema is out of date: column question_pdf_sources.status is missing. " +
      "Run supabase/migrations/20260818_question_bank_schema_patch.sql in Supabase SQL Editor, " +
      "then wait ~30s or reload the API schema cache (Project Settings → API)."
    );
  }
  if (m.includes("schema cache") && m.includes("question_pdf_sources")) {
    return (
      "Database schema is out of date for question_pdf_sources. " +
      "Run supabase/migrations/20260818_question_bank_schema_patch.sql in Supabase SQL Editor."
    );
  }
  if (/relation .*question_pdf_sources.* does not exist/i.test(message)) {
    return (
      "Table question_pdf_sources does not exist. " +
      "Run supabase/migrations/20260817_question_bank.sql in Supabase SQL Editor."
    );
  }
  if (/relation .*questions.* does not exist/i.test(message)) {
    return (
      "Table questions does not exist. " +
      "Run supabase/migrations/20260817_question_bank.sql in Supabase SQL Editor."
    );
  }
  return message;
}
