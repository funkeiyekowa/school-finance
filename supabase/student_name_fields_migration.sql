-- Add separate name fields to students table
ALTER TABLE students
ADD COLUMN IF NOT EXISTS last_name text,
ADD COLUMN IF NOT EXISTS first_name text,
ADD COLUMN IF NOT EXISTS middle_name text;

-- Backfill: split existing full_name into last_name (first word) and first_name (rest)
UPDATE students SET
  last_name = split_part(full_name, ' ', 1),
  first_name = CASE
    WHEN array_length(string_to_array(full_name, ' '), 1) > 1
    THEN split_part(full_name, ' ', 2)
    ELSE ''
  END,
  middle_name = CASE
    WHEN array_length(string_to_array(full_name, ' '), 1) > 2
    THEN array_to_string((string_to_array(full_name, ' '))[3:], ' ')
    ELSE ''
  END
WHERE last_name IS NULL;
