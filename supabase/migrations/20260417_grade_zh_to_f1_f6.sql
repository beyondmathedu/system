-- Standardize student grade values to canonical "F1".."F6" codes.
-- Handles legacy Chinese labels and dotted format values.

update public.students
set grade = case trim(grade)
  when '中一' then 'F1'
  when '中二' then 'F2'
  when '中三' then 'F3'
  when '中四' then 'F4'
  when '中五' then 'F5'
  when '中六' then 'F6'
  when 'F.1' then 'F1'
  when 'F.2' then 'F2'
  when 'F.3' then 'F3'
  when 'F.4' then 'F4'
  when 'F.5' then 'F5'
  when 'F.6' then 'F6'
  else grade
end
where trim(grade) in ('中一', '中二', '中三', '中四', '中五', '中六', 'F.1', 'F.2', 'F.3', 'F.4', 'F.5', 'F.6');

