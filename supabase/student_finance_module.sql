-- ============================================================
-- STUDENT FINANCE MODULE REGISTRATION
-- Registers student_finance as a separate module so schools
-- can subscribe to Students (SIS) and Student Finance independently.
--
-- Run after saas_foundation.sql.
-- ============================================================

-- Register the module
INSERT INTO platform_modules (key, name, description, category, is_core, sort_order) VALUES
  ('student_finance', 'Student Finance', 'Fee schedules, balances, payment tracking and debtors list per student', 'core', true, 3)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_core = EXCLUDED.is_core,
  sort_order = EXCLUDED.sort_order;

-- Enable it for all existing schools (it's core, so auto-enable)
INSERT INTO subscriptions (organization_id, module_key, status)
SELECT o.id, 'student_finance', 'active'
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions s
  WHERE s.organization_id = o.id AND s.module_key = 'student_finance'
)
ON CONFLICT (organization_id, module_key) DO NOTHING;

-- Update seed_org_defaults to include it for new schools
-- (The function already enables all is_core=true modules, so this is automatic.)

-- Also update the "students" module description to reflect it's now purely SIS
UPDATE platform_modules
SET name = 'Student Records (SIS)',
    description = 'Student master data, demographics, guardians, enrollment and class management'
WHERE key = 'students';
