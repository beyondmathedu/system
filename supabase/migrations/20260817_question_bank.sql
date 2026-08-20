-- Question bank MVP1: PDF sources + individual questions (AI-assisted import + human review).

create table if not exists public.question_pdf_sources (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  storage_path text not null,
  page_count integer not null default 0 check (page_count >= 0),
  status text not null default 'uploaded' check (
    status in ('uploaded', 'processing', 'ready', 'failed')
  ),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  question_code text unique,
  pdf_source_id uuid references public.question_pdf_sources (id) on delete set null,
  page_number integer not null check (page_number >= 1),
  question_label text not null default '',
  subject text,
  topic text,
  subtopic text,
  source_label text,
  source_year text,
  exam_type text,
  marks integer check (marks is null or marks > 0),
  time_minutes integer check (time_minutes is null or time_minutes > 0),
  difficulty text check (difficulty is null or difficulty in ('L1', 'L2', 'L3', 'needs_review')),
  ai_difficulty text check (ai_difficulty is null or ai_difficulty in ('L1', 'L2', 'L3', 'needs_review')),
  ai_difficulty_confidence numeric(5, 4) check (
    ai_difficulty_confidence is null
    or (ai_difficulty_confidence >= 0 and ai_difficulty_confidence <= 1)
  ),
  difficulty_reviewed boolean not null default false,
  image_path text,
  bbox_json jsonb,
  processing_status text not null default 'pending_review' check (
    processing_status in (
      'uploaded',
      'processing',
      'segmented',
      'metadata_extracted',
      'ai_classified',
      'pending_review',
      'approved',
      'needs_review',
      'failed'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_questions_processing_status on public.questions (processing_status);
create index if not exists idx_questions_difficulty on public.questions (difficulty);
create index if not exists idx_questions_topic on public.questions (topic);
create index if not exists idx_questions_pdf_source on public.questions (pdf_source_id);
create index if not exists idx_questions_source_label on public.questions (source_label);

alter table public.question_pdf_sources enable row level security;
alter table public.questions enable row level security;

drop policy if exists "allow all question_pdf_sources" on public.question_pdf_sources;
create policy "allow all question_pdf_sources"
  on public.question_pdf_sources for all using (true) with check (true);

drop policy if exists "allow all questions" on public.questions;
create policy "allow all questions"
  on public.questions for all using (true) with check (true);

insert into storage.buckets (id, name, public)
values
  ('question-assets', 'question-assets', false),
  ('question-bank-original-pdfs', 'question-bank-original-pdfs', false)
on conflict (id) do nothing;

comment on table public.question_pdf_sources is 'Uploaded exam PDF sources for AI-assisted question splitting.';
comment on table public.questions is 'Individual question images + metadata for paper generation.';

-- Idempotent column adds (safe when table existed from an earlier partial setup).
alter table public.question_pdf_sources
  add column if not exists page_count integer not null default 0,
  add column if not exists status text not null default 'uploaded',
  add column if not exists uploaded_by uuid references auth.users (id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.questions
  add column if not exists question_code text,
  add column if not exists processing_status text not null default 'pending_review',
  add column if not exists difficulty_reviewed boolean not null default false,
  add column if not exists bbox_json jsonb,
  add column if not exists ai_difficulty_confidence numeric(5, 4),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
