-- Patch: add missing question-bank columns when tables were created before the full schema existed.
-- Run in Supabase SQL Editor if you see "Could not find the 'status' column" errors.

alter table public.question_pdf_sources
  add column if not exists page_count integer not null default 0,
  add column if not exists status text not null default 'uploaded',
  add column if not exists uploaded_by uuid references auth.users (id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.questions
  add column if not exists question_code text,
  add column if not exists pdf_source_id uuid,
  add column if not exists page_number integer,
  add column if not exists question_label text not null default '',
  add column if not exists subject text,
  add column if not exists topic text,
  add column if not exists subtopic text,
  add column if not exists source_label text,
  add column if not exists source_year text,
  add column if not exists exam_type text,
  add column if not exists marks integer,
  add column if not exists time_minutes integer,
  add column if not exists difficulty text,
  add column if not exists ai_difficulty text,
  add column if not exists ai_difficulty_confidence numeric(5, 4),
  add column if not exists difficulty_reviewed boolean not null default false,
  add column if not exists image_path text,
  add column if not exists bbox_json jsonb,
  add column if not exists processing_status text not null default 'pending_review',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- FK + unique (ignore if already present)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'questions_pdf_source_id_fkey'
  ) then
    alter table public.questions
      add constraint questions_pdf_source_id_fkey
      foreign key (pdf_source_id) references public.question_pdf_sources (id) on delete set null;
  end if;
exception
  when duplicate_object then null;
end $$;

create unique index if not exists questions_question_code_key on public.questions (question_code);

insert into storage.buckets (id, name, public)
values
  ('question-assets', 'question-assets', false),
  ('question-bank-original-pdfs', 'question-bank-original-pdfs', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
