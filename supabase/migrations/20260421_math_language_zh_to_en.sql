-- Standardize students.math_language to canonical English labels.
-- Converts legacy Chinese labels to English.

update public.students
set math_language = case trim(math_language)
  when '中文' then 'Chinese'
  when '英文' then 'English'
  else math_language
end
where trim(math_language) in ('中文', '英文');
