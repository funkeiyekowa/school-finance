-- ============================================================
-- RFID Card Assignments
-- Maps physical card UIDs to students within an organisation.
-- Used by /api/attendance/rfid-ingest to resolve a card scan
-- to a student_id before calling ingest_attendance_from_device().
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rfid_card_assignments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id   uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  -- raw UID string as emitted by the HID keyboard reader (e.g. "A3F7C201")
  card_uid     text        NOT NULL,
  active       boolean     NOT NULL DEFAULT true,
  assigned_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rfid_card_assignments_uid_org_uq UNIQUE (org_id, card_uid)
);

-- Index for fast lookup during scan ingestion (org_id + card_uid)
CREATE INDEX IF NOT EXISTS rfid_card_assignments_org_uid_idx
  ON public.rfid_card_assignments (org_id, card_uid)
  WHERE active = true;

-- RLS
ALTER TABLE public.rfid_card_assignments ENABLE ROW LEVEL SECURITY;

-- Org members can read assignments in their org
CREATE POLICY "rfid_card_assignments_read" ON public.rfid_card_assignments
  FOR SELECT USING (org_id = public.current_user_org_id());

-- Only org admins can insert / update / delete
CREATE POLICY "rfid_card_assignments_insert" ON public.rfid_card_assignments
  FOR INSERT WITH CHECK (
    org_id = public.current_user_org_id()
    AND public.is_org_admin(public.current_user_org_id())
  );

CREATE POLICY "rfid_card_assignments_update" ON public.rfid_card_assignments
  FOR UPDATE USING (
    org_id = public.current_user_org_id()
    AND public.is_org_admin(public.current_user_org_id())
  );

CREATE POLICY "rfid_card_assignments_delete" ON public.rfid_card_assignments
  FOR DELETE USING (
    org_id = public.current_user_org_id()
    AND public.is_org_admin(public.current_user_org_id())
  );

-- ============================================================
-- RPC: resolve_rfid_card(p_org_id uuid, p_card_uid text)
-- Called by the service-role API route — bypasses RLS.
-- Returns the student_id for a given card, or raises an error
-- if the card is unknown or inactive.
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_rfid_card(
  p_org_id  uuid,
  p_card_uid text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid;
BEGIN
  SELECT student_id INTO v_student_id
  FROM rfid_card_assignments
  WHERE org_id  = p_org_id
    AND card_uid = p_card_uid
    AND active   = true
  LIMIT 1;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'RFID card not recognised or inactive: %', p_card_uid;
  END IF;

  RETURN v_student_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_rfid_card(uuid, text) TO service_role;

-- ============================================================
-- RPC: list_rfid_card_assignments(p_org_id uuid)
-- Returns card assignments with student name for admin UI.
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_rfid_card_assignments(p_org_id uuid)
RETURNS TABLE (
  id          uuid,
  student_id  uuid,
  student_name text,
  card_uid    text,
  active      boolean,
  assigned_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller must belong to this org
  IF p_org_id != public.current_user_org_id() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
    SELECT
      r.id,
      r.student_id,
      (s.first_name || ' ' || s.last_name) AS student_name,
      r.card_uid,
      r.active,
      r.assigned_at
    FROM rfid_card_assignments r
    JOIN students s ON s.id = r.student_id
    WHERE r.org_id = p_org_id
    ORDER BY s.last_name, s.first_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_rfid_card_assignments(uuid) TO authenticated;
