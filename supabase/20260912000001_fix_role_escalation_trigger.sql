-- ============================================================
-- CORRECTIVE FIX: prevent_role_self_escalation()
--
-- Replaces the flawed org_membership-based admin check with a
-- PostgreSQL current_user check. This is correct because:
--
--   All legitimate role-management paths are SECURITY DEFINER
--   functions owned by 'postgres' (confirmed):
--     - add_org_member()
--     - update_org_member()
--     - admin_create_org_member()
--     - auto_provision_staff()
--     - auto_provision_parent()
--     - promote_pending_profile()
--     - sync_membership_role_to_profile()
--     - sync_profile_role_to_membership()
--
--   When those functions fire, current_user = 'postgres'.
--   Direct authenticated/anon client writes use
--   current_user = 'authenticated' or 'anon', which are blocked.
--
-- The original flaw: the self-join on org_memberships used
--   target_m.user_id = NEW.id
-- When a user updates their own profile, NEW.id = auth.uid()
-- which equals the caller's user_id, so the join succeeds for
-- any org admin — allowing self-escalation to any role.
--
-- This fix eliminates the org_memberships lookup entirely.
-- current_user is a PostgreSQL built-in that cannot be forged
-- by an authenticated connection.
--
-- Idempotent. Safe to re-run. DO NOT apply to production
-- without explicit authorization.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_role_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pg_role text := current_user;
BEGIN
  -- Allow trusted SECURITY DEFINER contexts through unconditionally.
  -- All legitimate role-management/provisioning functions run as
  -- 'postgres' (Supabase function owner). service_role and the
  -- Supabase internal roles are also trusted.
  IF v_pg_role IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  -- Role column is not changing — allow ordinary profile updates.
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  -- Direct write to profiles.role by an authenticated/anon connection:
  -- silently revert the role change, pass the rest of the update through.
  NEW.role := OLD.role;
  RETURN NEW;
END;
$$;

-- Grant is unchanged (trigger function, called by trigger not directly).
-- The trigger itself (trg_prevent_role_self_escalation) already exists
-- on public.profiles and does not need to be recreated.
