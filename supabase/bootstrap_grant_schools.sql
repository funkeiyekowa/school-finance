-- ============================================================
-- BOOTSTRAP — Grant Schools + super developer account
--
-- WHAT THIS FIXES
-- ---------------
-- If you created an organization and then could not see it, this is
-- why: the original policy on `organizations` only allows you to
-- SELECT rows for orgs you are a MEMBER of. Its super-admin escape
-- hatch checks for an org_memberships row with role = 'super_admin',
-- and nobody had one. So the INSERT worked and the row instantly
-- became invisible. Your schools are still in the table.
--
-- Run this AFTER:
--   1. schema.sql
--   2. multi_tenant_migration.sql
--   3. tenant_isolation_enforcement.sql
--   4. saas_foundation.sql
--   5. website_module.sql
--
-- WHAT IT DOES
--   A. Sets your account up as a platform super developer.
--   B. Names the primary tenant "Grant Schools" and turns on
--      every module for it.
--   C. Adopts any orphaned organizations you already created so
--      they become visible again.
--   D. Prints a verification summary at the end.
--
-- >>> EDIT THE EMAIL ON THE NEXT LINE BEFORE RUNNING <<<
-- ============================================================

DO $$
DECLARE
  -- ####################################################
  -- ##  PUT YOUR LOGIN EMAIL HERE                     ##
  v_admin_email text := 'ayodeji.olabooye@gmail.com';
  -- ##  Name for the primary school                   ##
  v_school_name text := 'Grant Schools';
  v_school_slug text := 'grant-schools';
  -- ####################################################

  v_user uuid;
  v_org  uuid;
  v_count int;
  v_orphans int := 0;
BEGIN
  v_admin_email := lower(trim(v_admin_email));

  IF v_admin_email = 'change_me@example.com' THEN
    RAISE EXCEPTION
      'Edit v_admin_email at the top of this script to your login email address first.';
  END IF;

  -- ----------------------------------------------------------
  -- A. Find the account
  -- ----------------------------------------------------------
  SELECT id INTO v_user FROM auth.users WHERE lower(email) = v_admin_email LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION
      'No account exists for %. Sign up in the app first (or create the user under Authentication -> Users), then re-run this script.',
      v_admin_email;
  END IF;

  -- Make sure a profile row exists and is a developer, which is what
  -- is_platform_admin() looks for.
  INSERT INTO profiles (id, email, full_name, role, active)
  VALUES (v_user, v_admin_email, 'Platform Developer', 'developer', true)
  ON CONFLICT (id) DO UPDATE
    SET role = 'developer', active = true;

  RAISE NOTICE 'Account % promoted to developer.', v_admin_email;

  -- ----------------------------------------------------------
  -- B. The primary tenant
  -- ----------------------------------------------------------
  -- Prefer the org this user already belongs to, then the migration's
  -- 'default' org, then the oldest org, then create one.
  SELECT m.organization_id INTO v_org
  FROM org_memberships m
  WHERE m.user_id = v_user
  ORDER BY m.is_default DESC, m.joined_at
  LIMIT 1;

  IF v_org IS NULL THEN
    SELECT id INTO v_org FROM organizations WHERE slug = 'default' LIMIT 1;
  END IF;

  IF v_org IS NULL THEN
    SELECT id INTO v_org FROM organizations ORDER BY created_at LIMIT 1;
  END IF;

  IF v_org IS NULL THEN
    INSERT INTO organizations (name, slug, status, plan)
    VALUES (v_school_name, v_school_slug, 'active', 'enterprise')
    RETURNING id INTO v_org;
    RAISE NOTICE 'Created organization % (%).', v_school_name, v_org;
  ELSE
    -- Rename in place. The slug is only changed when it is free, so we
    -- never break another tenant's hostname.
    UPDATE organizations
    SET name   = v_school_name,
        status = 'active',
        plan   = 'enterprise',
        slug   = CASE
                   WHEN slug = v_school_slug THEN slug
                   WHEN EXISTS (SELECT 1 FROM organizations o2
                                WHERE o2.slug = v_school_slug AND o2.id <> organizations.id)
                     THEN slug
                   ELSE v_school_slug
                 END,
        updated_at = now()
    WHERE id = v_org;
    RAISE NOTICE 'Organization % renamed to %.', v_org, v_school_name;
  END IF;

  -- Bind the developer to it as super_admin, and make it the landing org.
  INSERT INTO org_memberships (user_id, organization_id, role, is_default, active)
  VALUES (v_user, v_org, 'super_admin', false, true)
  ON CONFLICT (user_id, organization_id)
    DO UPDATE SET role = 'super_admin', active = true;

  UPDATE org_memberships SET is_default = false
   WHERE user_id = v_user AND organization_id <> v_org;
  UPDATE org_memberships SET is_default = true
   WHERE user_id = v_user AND organization_id = v_org;

  -- Every module, for this school.
  INSERT INTO subscriptions (organization_id, module_key, status)
  SELECT v_org, key, 'active' FROM platform_modules
  ON CONFLICT (organization_id, module_key)
    DO UPDATE SET status = 'active';

  SELECT count(*) INTO v_count FROM subscriptions
   WHERE organization_id = v_org AND status = 'active';
  RAISE NOTICE '% modules enabled for %.', v_count, v_school_name;

  -- Roles, settings row, categories for this tenant.
  PERFORM seed_org_defaults(v_org);

  -- Keep the school_settings name aligned with the org name.
  UPDATE school_settings SET school_name = v_school_name WHERE organization_id = v_org;

  -- ----------------------------------------------------------
  -- C. Adopt orphaned organizations
  -- ----------------------------------------------------------
  -- Any school with no members at all is one you created before the
  -- read policy was fixed. Attach the developer so it reappears.
  FOR v_count IN
    SELECT 1 FROM organizations o
    WHERE NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.organization_id = o.id)
  LOOP
    v_orphans := v_orphans + 1;
  END LOOP;

  INSERT INTO org_memberships (user_id, organization_id, role, is_default, active)
  SELECT v_user, o.id, 'super_admin', false, true
  FROM organizations o
  WHERE NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.organization_id = o.id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  IF v_orphans > 0 THEN
    RAISE NOTICE 'Adopted % organization(s) that had no members.', v_orphans;
  END IF;

  -- Give every school its own roles / settings / core modules, so none
  -- of them is half-provisioned.
  PERFORM seed_org_defaults(o.id) FROM organizations o;

  RAISE NOTICE 'Bootstrap complete. Sign out and sign in again.';
END $$;


-- ============================================================
-- VERIFICATION — read the four result sets below
-- ============================================================

-- 1. Your platform admin status. is_platform_admin must be true.
SELECT
  u.email,
  p.role                        AS profile_role,
  p.active                      AS profile_active,
  m.role                        AS membership_role,
  m.is_default                  AS lands_here,
  o.name                        AS organization,
  o.slug,
  o.status,
  (p.role = 'developer' AND p.active)
    OR m.role = 'super_admin'   AS is_platform_admin
FROM auth.users u
LEFT JOIN profiles p        ON p.id = u.id
LEFT JOIN org_memberships m ON m.user_id = u.id AND m.is_default
LEFT JOIN organizations o   ON o.id = m.organization_id
ORDER BY u.created_at;

-- 2. Every school, with member and module counts.
--    "members = 0" means nobody can sign into that school.
SELECT
  o.name,
  o.slug,
  o.status,
  o.plan,
  (SELECT count(*) FROM org_memberships m WHERE m.organization_id = o.id) AS members,
  (SELECT count(*) FROM subscriptions s
    WHERE s.organization_id = o.id AND s.status = 'active')               AS active_modules,
  o.created_at
FROM organizations o
ORDER BY o.created_at;

-- 3. Modules enabled for Grant Schools.
SELECT pm.key, pm.name, pm.category, pm.is_core,
       (s.id IS NOT NULL) AS enabled
FROM platform_modules pm
LEFT JOIN subscriptions s
  ON s.module_key = pm.key
 AND s.status = 'active'
 AND s.organization_id = (SELECT id FROM organizations ORDER BY created_at LIMIT 1)
ORDER BY pm.sort_order;

-- 4. Anyone who cannot sign in usefully because they have no school.
SELECT u.email, p.role, p.active, 'No organization membership' AS problem
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = u.id);
