-- Add textbook publisher field for students form/listing.
alter table public.students
add column if not exists textbook_publisher text;
