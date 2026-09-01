-- =====================================================================
-- FIX: report_cards / report_card_subjects / parent_profiles /
-- parent_student_links / cbt_exam_assignments RLS policies were
-- resolving the caller's org from profiles.organization_id, the same
-- stale legacy column that broke students_paginated / staff_paginated
-- (see fix_staff_students_org_resolution.sql for the full explanation).
--
-- profiles.organization_id is set once during migration and never
-- updated when a user switches active org via switch_active_org()
-- (which flips org_memberships.is_default instead). Every other RLS
-- policy in this app resolves the caller's org through
-- current_user_org_id() for exactly that reason -- these 5 policies
-- were the odd ones out, originally defined in
-- report_card_and_portals_migration.sql.
--
-- Symptom this fixes: a super_admin who switches into another org's
-- context cannot see that org's report cards, parent portal profiles/
-- links, or CBT exam assignments -- same failure mode as the Staff/
-- Students pages, just via RLS instead of an RPC.
--
-- The original policies were created with
-- "EXCEPTION WHEN duplicate_object THEN NULL", so simply re-running
-- that file again is a no-op and does NOT pick up this fix -- the
-- policy must be dropped and recreated. SAFE TO RE-RUN.
-- =====================================================================

DROP POLICY IF EXISTS report_cards_org_isolation ON report_cards;
CREATE POLICY report_cards_org_isolation ON report_cards
  USING (organization_id = current_user_org_id());

DROP POLICY IF EXISTS rcs_org_isolation ON report_card_subjects;
CREATE POLICY rcs_org_isolation ON report_card_subjects
  USING (organization_id = current_user_org_id());

DROP POLICY IF EXISTS parent_profiles_org_isolation ON parent_profiles;
CREATE POLICY parent_profiles_org_isolation ON parent_profiles
  USING (organization_id = current_user_org_id());

DROP POLICY IF EXISTS psl_org_isolation ON parent_student_links;
CREATE POLICY psl_org_isolation ON parent_student_links
  USING (organization_id = current_user_org_id());

DROP POLICY IF EXISTS cea_org_isolation ON cbt_exam_assignments;
CREATE POLICY cea_org_isolation ON cbt_exam_assignments
  USING (organization_id = current_user_org_id());
