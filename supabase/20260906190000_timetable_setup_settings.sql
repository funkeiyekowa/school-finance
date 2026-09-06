-- ============================================================
-- TIMETABLE SETUP SETTINGS
-- ============================================================
-- Adds a per-organisation "timetable_settings" table so admins can
-- configure how the timetable displays/prints (which fields show,
-- paper size/orientation, density, fonts, colours, title/footer
-- text) without touching timetable allocation data
-- (classes/subjects/periods/timetable_entries) or the role-based
-- read access already enforced by
-- fix_timetable_role_scoped_access.sql.
--
-- This is a brand-new table rather than bolting more columns onto
-- school_settings: school_settings's RLS is legacy (profiles.role =
-- 'admin' with no organization_id filter at all on its SELECT
-- policy -- a pre-existing cross-tenant read gap that predates this
-- change and is out of scope to fix here) and its convention is
-- already 30+ columns of mixed concerns. timetable_settings uses
-- the modern is_org_admin()/is_org_member() helpers from
-- saas_foundation.sql instead, which are already GRANTed to
-- authenticated and are the correct pattern for a new
-- single-row-per-org, admin-writable, all-org-members-readable
-- table.
--
-- Read path: any authenticated member of the org (student, teacher,
-- staff, admin) can read their own org's settings row, since the
-- print/display pages need it for every role. Write path: org
-- admins only (is_org_admin), matching every other Setup page.
--
-- Nothing here changes classes/subjects/periods/timetable_entries
-- or their policies, and nothing here changes who may see which
-- class's timetable data -- that remains exactly as enforced by
-- fix_timetable_role_scoped_access.sql.
--
-- Run order: after fix_timetable_role_scoped_access.sql (already
-- above in the README) and after saas_foundation.sql (for
-- is_org_admin/is_org_member, already above).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.timetable_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Field visibility (display + print)
  show_teacher boolean NOT NULL DEFAULT true,
  show_subject boolean NOT NULL DEFAULT true,
  show_class boolean NOT NULL DEFAULT true,
  show_period_times boolean NOT NULL DEFAULT true,
  show_breaks boolean NOT NULL DEFAULT true,
  show_room boolean NOT NULL DEFAULT true,
  show_logo boolean NOT NULL DEFAULT true,
  show_school_name boolean NOT NULL DEFAULT true,
  show_session boolean NOT NULL DEFAULT true,
  show_term boolean NOT NULL DEFAULT true,

  -- Title / footer text (blank = fall back to the existing default
  -- text the print page already uses, e.g. "Class Timetable")
  document_title text,
  footer_text text,

  -- Print / paper setup
  paper_size text NOT NULL DEFAULT 'A4'
    CHECK (paper_size IN ('A4', 'A3', 'Letter', 'Legal')),
  orientation text NOT NULL DEFAULT 'landscape'
    CHECK (orientation IN ('portrait', 'landscape')),

  -- Layout density / typography
  layout_density text NOT NULL DEFAULT 'comfortable'
    CHECK (layout_density IN ('compact', 'comfortable', 'spacious')),
  font_size_pt integer NOT NULL DEFAULT 10 CHECK (font_size_pt BETWEEN 7 AND 16),
  cell_padding_px integer NOT NULL DEFAULT 6 CHECK (cell_padding_px BETWEEN 0 AND 24),
  show_borders boolean NOT NULL DEFAULT true,

  -- Colours (hex strings; null = fall back to the design system
  -- defaults already used everywhere else, #0F2A47 / #C9A227)
  primary_color text,
  accent_color text,
  break_row_color text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_settings_org
  ON public.timetable_settings(organization_id);

-- Keep updated_at current on every write, matching the codebase's
-- other settings-style tables.
CREATE OR REPLACE FUNCTION public._timetable_settings_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_timetable_settings_touch_updated_at ON public.timetable_settings;
CREATE TRIGGER trg_timetable_settings_touch_updated_at
  BEFORE UPDATE ON public.timetable_settings
  FOR EACH ROW
  EXECUTE FUNCTION public._timetable_settings_touch_updated_at();

ALTER TABLE public.timetable_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS timetable_settings_read ON public.timetable_settings;
DROP POLICY IF EXISTS timetable_settings_write ON public.timetable_settings;

-- Any org member (any role, including students/teachers) can read
-- their own org's timetable display/print settings -- the print
-- page needs this regardless of who is viewing.
CREATE POLICY timetable_settings_read ON public.timetable_settings
  FOR SELECT
  USING (is_org_member(organization_id));

-- Only org admins can create/update/delete the settings row.
CREATE POLICY timetable_settings_write ON public.timetable_settings
  FOR ALL
  USING (is_org_admin(organization_id))
  WITH CHECK (is_org_admin(organization_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.timetable_settings TO authenticated;

-- ------------------------------------------------------------
-- get_my_timetable_settings()
-- ------------------------------------------------------------
-- Convenience RPC returning the caller's org's settings row (or
-- NULL if the org admin hasn't configured any yet, in which case
-- the frontend applies the same column defaults declared above).
-- SECURITY INVOKER is fine here -- RLS on the SELECT already scopes
-- correctly to any org member -- but SECURITY DEFINER is used to
-- match this codebase's established convention for helper RPCs and
-- to guarantee a single, predictable row lookup by
-- current_user_org_id() regardless of future RLS changes.
CREATE OR REPLACE FUNCTION public.get_my_timetable_settings()
RETURNS public.timetable_settings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ts.*
  FROM public.timetable_settings ts
  WHERE ts.organization_id = current_user_org_id();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_timetable_settings() TO authenticated;

-- ============================================================
-- VERIFICATION (run after applying, expect the rows below)
-- ============================================================

-- Expect exactly 2 policies (read, write):
-- SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'timetable_settings';

-- Expect 1 row (this function):
-- SELECT proname FROM pg_proc WHERE proname = 'get_my_timetable_settings';

-- Expect one row per org that has saved settings, else empty (safe: the
-- frontend must apply defaults when no row exists yet):
-- SELECT organization_id, paper_size, orientation, show_teacher, show_subject FROM public.timetable_settings;
