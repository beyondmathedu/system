# Supabase Migration Checklist

Use this checklist every time you change database schema or data rules.

## 1) Before you run anything

- Put all SQL changes into files under `supabase/migrations/`.
- Use one purpose per file (e.g. add column, data cleanup, constraint update).
- Name files with timestamp prefix so order is clear, e.g. `20260421_add_xxx.sql`.

## 2) During development

- Run the full file content (not partial copy/paste) when testing in SQL Editor.
- If one migration depends on another, run by filename order (oldest -> newest).
- After each file, check for errors immediately before moving on.

## 3) Pre-deploy checks

- Confirm all migration files are committed and pushed.
- Confirm app code that depends on new columns/constraints is also pushed.
- Confirm no local-only SQL is missing from migration files.

## 4) Apply to target environment

- Apply migrations in order (do not manually reorder).
- Do not skip "data cleanup" migrations if later constraints depend on cleaned data.
- If a constraint fails, fix data first, then apply constraint migration again.

## 5) Quick validation queries

Run these after deployment (adjust fields for your feature):

```sql
select grade, count(*) from public.students group by grade order by grade;
select math_language, count(*) from public.students group by math_language order by math_language;
select textbook_publisher, count(*) from public.students group by textbook_publisher order by textbook_publisher;
```

Expected for current project:

- `grade` uses canonical values `F1` to `F6`
- `math_language` uses `Chinese` / `English`
- `textbook_publisher` exists (null is allowed)

## 6) Safety rules

- Never run ad-hoc SQL in production without also creating a migration file.
- Never paste only part of a migration file.
- Never edit or delete old migration files that were already applied.

## 7) If you are unsure

- Stop before running SQL.
- Ask: "Which migration files should be applied for this release?"
- Apply only those files in timestamp order.
