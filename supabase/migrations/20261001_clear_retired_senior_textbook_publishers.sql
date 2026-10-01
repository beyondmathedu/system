-- Clear retired senior textbook options from student records.
-- Kept options such as "Mathematics in Focus (2nd)", "Mastering Mathematics (2nd Edition)",
-- "Mathematics in Action (3rd)", and junior "New Effective Learning" are not touched.

update public.students
set textbook_publisher = null
where textbook_publisher is not null
  and (
    -- Stored as "Publisher · Title"
    trim(split_part(textbook_publisher, ' · ', 2)) in (
      'Effective Learning',
      'Mathematics in Focus',
      'New Progress in Senior Mathematics',
      'New Century Mathematics (2nd Edition)',
      'Mastering Mathematics',
      'Mathematics in Action (2nd Edition)'
    )
    -- Or legacy bare title (no publisher prefix)
    or trim(textbook_publisher) in (
      'Effective Learning',
      'Mathematics in Focus',
      'New Progress in Senior Mathematics',
      'New Century Mathematics (2nd Edition)',
      'Mastering Mathematics',
      'Mathematics in Action (2nd Edition)',
      'Chung Tai · Effective Learning',
      'Ephhk · Mathematics in Focus',
      'HKEP · New Progress in Senior Mathematics',
      'Oxford · New Century Mathematics (2nd Edition)',
      'Pearson · Mastering Mathematics',
      'Pearson · Mathematics in Action (2nd Edition)'
    )
  );
