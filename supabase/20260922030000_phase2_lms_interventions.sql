-- Run after 20260922014500_phase2_lms_student_submissions.sql and 20260922024500_phase2_teaching_plans.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS public.lms_student_interventions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
 student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
 assignment_id uuid REFERENCES public.lms_assignments(id) ON DELETE SET NULL,
 category text NOT NULL CHECK(category IN('missing_work','low_performance','attendance','engagement','other')),
 priority text NOT NULL DEFAULT'medium' CHECK(priority IN('low','medium','high','urgent')),
 reason text NOT NULL,
 action_plan text,
 status text NOT NULL DEFAULT'open' CHECK(status IN('open','in_progress','resolved')),
 owner_id uuid REFERENCES auth.users(id),
 due_date date,
 family_visible boolean NOT NULL DEFAULT false,
 resolution text,
 resolved_at timestamptz,
 resolved_by uuid REFERENCES auth.users(id),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(char_length(reason) BETWEEN 1 AND 1000),
 CHECK(action_plan IS NULL OR char_length(action_plan)<=5000),
 CHECK(resolution IS NULL OR char_length(resolution)<=5000)
);
CREATE INDEX IF NOT EXISTS idx_lms_interventions_course ON public.lms_student_interventions(organization_id,course_id,status,due_date);
CREATE INDEX IF NOT EXISTS idx_lms_interventions_student ON public.lms_student_interventions(organization_id,student_id,status);
ALTER TABLE public.lms_student_interventions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interventions_read ON public.lms_student_interventions;
CREATE POLICY interventions_read ON public.lms_student_interventions FOR SELECT USING(
 organization_id=public.current_user_org_id() AND(
  public.is_org_admin(organization_id) OR public.phase1_teacher_course_scope(course_id) OR
  (family_visible AND EXISTS(SELECT 1 FROM public.students s WHERE s.id=student_id AND s.profile_id=auth.uid())) OR
  (family_visible AND student_id IN(SELECT linked.student_id FROM public.my_linked_student_ids() linked))
 )
);
DROP POLICY IF EXISTS interventions_write ON public.lms_student_interventions;
CREATE POLICY interventions_write ON public.lms_student_interventions FOR ALL USING(
 organization_id=public.current_user_org_id() AND(public.is_org_admin(organization_id) OR public.phase1_teacher_course_scope(course_id))
) WITH CHECK(
 organization_id=public.current_user_org_id() AND(public.is_org_admin(organization_id) OR public.phase1_teacher_course_scope(course_id))
);
CREATE OR REPLACE FUNCTION public.phase2_save_student_intervention(
 p_intervention_id uuid,p_course_id uuid,p_student_id uuid,p_assignment_id uuid,p_category text,p_priority text,p_reason text,p_action_plan text,p_status text,p_owner_id uuid,p_due_date date,p_family_visible boolean,p_resolution text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid:=public.current_user_org_id();v_id uuid;v_existing public.lms_student_interventions%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR v_org IS NULL THEN RAISE EXCEPTION'Authentication required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lms_courses c WHERE c.id=p_course_id AND c.organization_id=v_org FOR UPDATE) OR NOT(public.is_org_admin(v_org) OR public.phase1_teacher_course_scope(p_course_id))THEN RAISE EXCEPTION'Not authorized for course';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lms_enrollments e WHERE e.organization_id=v_org AND e.course_id=p_course_id AND e.student_id=p_student_id AND e.status='active')THEN RAISE EXCEPTION'Student is not actively enrolled';END IF;
 IF p_assignment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lms_assignments a JOIN public.lms_lessons l ON l.id=a.lesson_id WHERE a.id=p_assignment_id AND a.organization_id=v_org AND l.course_id=p_course_id)THEN RAISE EXCEPTION'Assignment does not belong to course';END IF;
 IF p_owner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.org_memberships m WHERE m.organization_id=v_org AND m.user_id=p_owner_id AND m.active=true)THEN RAISE EXCEPTION'Owner must be an active organization member';END IF;
 IF p_category NOT IN('missing_work','low_performance','attendance','engagement','other') OR p_priority NOT IN('low','medium','high','urgent') OR p_status NOT IN('open','in_progress','resolved')THEN RAISE EXCEPTION'Invalid intervention classification';END IF;
 IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION'Reason must be 1 to 1000 characters';END IF;
 IF p_status='resolved'AND btrim(coalesce(p_resolution,''))=''THEN RAISE EXCEPTION'Resolution summary is required';END IF;
 IF p_intervention_id IS NULL THEN
  INSERT INTO public.lms_student_interventions(organization_id,course_id,student_id,assignment_id,category,priority,reason,action_plan,status,owner_id,due_date,family_visible,resolution,resolved_at,resolved_by,created_by)
  VALUES(v_org,p_course_id,p_student_id,p_assignment_id,p_category,p_priority,btrim(p_reason),nullif(btrim(coalesce(p_action_plan,'')),''),p_status,coalesce(p_owner_id,auth.uid()),p_due_date,coalesce(p_family_visible,false),nullif(btrim(coalesce(p_resolution,'')),''),CASE WHEN p_status='resolved'THEN now()END,CASE WHEN p_status='resolved'THEN auth.uid()END,auth.uid()) RETURNING id INTO v_id;
 ELSE
  SELECT*INTO v_existing FROM public.lms_student_interventions WHERE id=p_intervention_id AND organization_id=v_org AND course_id=p_course_id FOR UPDATE;
  IF v_existing.id IS NULL THEN RAISE EXCEPTION'Intervention not found';END IF;
  IF v_existing.student_id IS DISTINCT FROM p_student_id THEN RAISE EXCEPTION'Intervention student cannot be changed';END IF;
  IF v_existing.status='resolved'AND p_status<>'resolved'AND NOT public.is_org_admin(v_org)THEN RAISE EXCEPTION'Only an admin can reopen a resolved intervention';END IF;
  UPDATE public.lms_student_interventions SET assignment_id=p_assignment_id,category=p_category,priority=p_priority,reason=btrim(p_reason),action_plan=nullif(btrim(coalesce(p_action_plan,'')),''),status=p_status,owner_id=coalesce(p_owner_id,owner_id),due_date=p_due_date,family_visible=coalesce(p_family_visible,false),resolution=nullif(btrim(coalesce(p_resolution,'')),''),resolved_at=CASE WHEN p_status='resolved'THEN coalesce(resolved_at,now())ELSE NULL END,resolved_by=CASE WHEN p_status='resolved'THEN coalesce(resolved_by,auth.uid())ELSE NULL END,updated_at=now() WHERE id=v_existing.id RETURNING id INTO v_id;
 END IF;RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.phase2_save_student_intervention(uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,date,boolean,text)FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.phase2_save_student_intervention(uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,date,boolean,text)TO authenticated;
COMMIT;
