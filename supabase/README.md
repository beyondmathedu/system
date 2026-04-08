# 資料庫 SQL（Supabase）

所有與本專案相關的 **手動在 Supabase SQL Editor 執行** 的腳本都放在此資料夾。建議用 **Git 追蹤**，並在團隊內約定「只加新的 migration、不亂改已上線的歷史檔」。

## 建議執行順序（新專案 / 空資料庫）

| 順序 | 檔案 | 說明 |
|------|------|------|
| 1 | `supabase-students.sql` | 建立 `students` 表與 RLS |
| 2 | `supabase_student_lessons_schema.sql` | 學生考試日、課堂記錄、導師、課室、年度課表等核心表（開頭含 teacher→tutor 更名，可重複執行） |
| 3 | `supabase_app_payroll_settings.sql` | 多人同時段「第一席位」金額（`app_payroll_settings`） |
| 4 | `supabase_tutor_color_hex.sql` | 導師顯示色碼欄位 |
| 5 | `supabase_classrooms_regular_period_max.sql` | 課室「恆常每時段上限」欄位（`/regular-class-timetable` 餘額） |
| 6 | `supabase_timetable_day_remarks.sql` | 學生×日期 remarks（若仍使用相關功能） |
| 7 | `supabase_student_monthly_fee_records.sql` | 學生每月手填欄位（學費記錄頁） |

## 僅在「舊庫仍是 teachers / teacher_rates」時

- 執行 **`supabase_migrate_teacher_to_tutor.sql`**（或依賴 `supabase_student_lessons_schema.sql` 開頭的同名邏輯，兩者重疊處擇一即可）。

若你的資料庫 **已經是** `tutors` / `tutor_rates`，可略過此檔。

## 怎樣做會比較好（實務習慣）

1. **一份檔案一個主題**：加新功能時新增新 `.sql`（例如 `supabase_xxx_feature.sql`），少改舊檔，方便對照「哪天加了什麼」。
2. **盡量可重複執行**：使用 `if not exists`、`add column if not exists`、`drop policy if exists` … 再 `create policy`，避免第二次執行整段失敗。
3. **在 Supabase 備份**：大改前先 Dashboard → Database → Backup，或匯出 schema。
4. **進階**：若專案變大，可改用 [Supabase CLI migrations](https://supabase.com/docs/guides/cli/local-development#database-migrations)（`supabase/migrations/` 帶時間戳記），與本資料夾手動腳本二選一或逐步遷移即可。

## 點解決：介面亂、重複 remarks、重跑報錯

### 1. Supabase SQL Editor「PRIVATE」太亂

- **只保留一條「正式版」**：同一個功能（例如 `student_timetable_day_remarks`）只對應 **一個** 已存查詢；其餘內容若重複，**刪掉或改名** 成 `（舊版勿用）` 再封存。
- **用命名前綴**：例如 `CORE_01_students`、`COL_classrooms_regular_max`、`DEBUG_list_public_tables`，雜項查詢一律用 `DEBUG_` 或 `ZZ_`，排喺最底，唔會同 migration 撈亂。
- **真源在 repo**：真正要再執行／給同事，一律 **從本資料夾複製 `.sql`** 到 SQL Editor，而唔係靠 Supabase 裡面舊片段；咁唔會有「兩個版本邊條啱」。

### 2. 重複執行 `CREATE` 會報錯

PostgreSQL 常用做法（本 repo 腳本已盡量跟住）：

| 情境 | 寫法 |
|------|------|
| 建表 | `create table if not exists ...` |
| 加欄 | `alter table ... add column if not exists ...` |
| 建索引 | `create index if not exists ...` |
| RLS policy | `drop policy if exists "名稱" on public.表名;` 再 `create policy ...` |
| 只插入預設列 | `insert ... on conflict (...) do nothing` 或 `do update` |

若舊腳本係 **冇 `if not exists` 嘅 `create table`**，唔好再貼一次；要改就 **新開一個 `.sql` 只做 `alter table ... add column`**，或將舊檔改做 idempotent 後放 Git。

### 3. 兩條 remarks 腳本唔知用邊條

- 對照 **表名**（本專案為 `student_timetable_day_remarks`，見 `supabase_timetable_day_remarks.sql`）。
- 喺 Supabase **Table Editor** 睇該表是否已存在；已存在就只保留 **與 repo 一致** 嗰條，另一條刪除或改名。

## 檔案一覽

| 檔案 | 用途摘要 |
|------|----------|
| `supabase-students.sql` | 學生主表 |
| `supabase_student_lessons_schema.sql` | 課程／導師／課室／JSON 課表等 |
| `supabase_app_payroll_settings.sql` | 薪資設定（多人第一席位金額） |
| `supabase_tutor_color_hex.sql` | `tutors.color_hex` |
| `supabase_classrooms_regular_period_max.sql` | `classrooms.regular_period_max` |
| `supabase_timetable_day_remarks.sql` | `student_timetable_day_remarks` |
| `supabase_student_monthly_fee_records.sql` | `student_monthly_fee_records` |
| `supabase_migrate_teacher_to_tutor.sql` | 舊表名遷移至 tutor（僅舊庫需要） |
