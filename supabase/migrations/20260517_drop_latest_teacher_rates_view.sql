-- 舊版 teacher → tutor 遷移後的殘留 view；應用程式只使用 latest_tutor_rates。
-- 刪除後可消除 Supabase「Security Definer View」警告。

drop view if exists public.latest_teacher_rates;
