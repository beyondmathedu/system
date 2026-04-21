-- Migrate student grade values from "中一".."中六" to "F1".."F6".
-- This keeps existing semantics while standardising all grade codes.

update public.students
set grade = case trim(grade)
  when '中一' then 'F1'
  when '中二' then 'F2'
  when '中三' then 'F3'
  when '中四' then 'F4'
  when '中五' then 'F5'
  when '中六' then 'F6'
  else grade
end
where grade in ('中一', '中二', '中三', '中四', '中五', '中六');

