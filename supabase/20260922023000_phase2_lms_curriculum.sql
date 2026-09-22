-- Run after lms_module.sql and 20260905120000_phase1_security_enforcement.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS public.lms_curriculum_units(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,title text NOT NULL,description text,sequence integer NOT NULL DEFAULT 1,published boolean NOT NULL DEFAULT false,created_by uuid REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(course_id,sequence),CHECK(char_length(title) BETWEEN 1 AND 200),CHECK(description IS NULL OR char_length(description)<=5000),CHECK(sequence BETWEEN 1 AND 1000));
CREATE TABLE IF NOT EXISTS public.lms_learning_objectives(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,unit_id uuid NOT NULL REFERENCES public.lms_curriculum_units(id) ON DELETE CASCADE,code text,description text NOT NULL,sequence integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(unit_id,sequence),CHECK(code IS NULL OR char_length(code)<=50),CHECK(char_length(description) BETWEEN 1 AND 1000),CHECK(sequence BETWEEN 1 AND 100));
CREATE INDEX IF NOT EXISTS idx_curriculum_course ON public.lms_curriculum_units(organization_id,course_id,sequence);
CREATE INDEX IF NOT EXISTS idx_objectives_unit ON public.lms_learning_objectives(organization_id,unit_id,sequence);
ALTER TABLE public.lms_curriculum_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_learning_objectives ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS curriculum_read ON public.lms_curriculum_units;
CREATE POLICY curriculum_read ON public.lms_curriculum_units FOR SELECT USING(organization_id=public.current_user_org_id() AND (public.is_org_admin(organization_id) OR public.phase1_teacher_course_scope(course_id) OR (published AND EXISTS(SELECT 1 FROM public.lms_enrollments e JOIN public.students s ON s.id=e.student_id WHERE e.course_id=lms_curriculum_units.course_id AND e.organization_id=lms_curriculum_units.organization_id AND e.status='active' AND s.profile_id=auth.uid()))));
DROP POLICY IF EXISTS curriculum_write ON public.lms_curriculum_units;
CREATE POLICY curriculum_write ON public.lms_curriculum_units FOR ALL USING(organization_id=public.current_user_org_id() AND (public.is_org_admin(organization_id) OR public.phase1_teacher_course_scope(course_id))) WITH CHECK(organization_id=public.current_user_org_id() AND (public.is_org_admin(organization_id) OR public.phase1_teacher_course_scope(course_id)));
DROP POLICY IF EXISTS objectives_read ON public.lms_learning_objectives;
CREATE POLICY objectives_read ON public.lms_learning_objectives FOR SELECT USING(organization_id=public.current_user_org_id() AND EXISTS(SELECT 1 FROM public.lms_curriculum_units u WHERE u.id=unit_id));
DROP POLICY IF EXISTS objectives_write ON public.lms_learning_objectives;
CREATE POLICY objectives_write ON public.lms_learning_objectives FOR ALL USING(organization_id=public.current_user_org_id() AND EXISTS(SELECT 1 FROM public.lms_curriculum_units u WHERE u.id=unit_id AND (public.is_org_admin(u.organization_id) OR public.phase1_teacher_course_scope(u.course_id)))) WITH CHECK(organization_id=public.current_user_org_id());
CREATE OR REPLACE FUNCTION public.phase2_save_curriculum_unit(p_course_id uuid,p_unit_id uuid,p_title text,p_description text,p_sequence integer,p_published boolean,p_objectives jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid:=public.current_user_org_id();v_unit uuid;v_count integer;v_item jsonb;v_seq integer:=0;
BEGIN
 IF auth.uid() IS NULL OR v_org IS NULL THEN RAISE EXCEPTION 'Authentication required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lms_courses c WHERE c.id=p_course_id AND c.organization_id=v_org FOR UPDATE) THEN RAISE EXCEPTION 'Course not found';END IF;
 IF NOT(public.is_org_admin(v_org) OR public.phase1_teacher_course_scope(p_course_id)) THEN RAISE EXCEPTION 'Not authorized';END IF;
 IF char_length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Title must be 1 to 200 characters';END IF;
 IF p_sequence NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Sequence must be between 1 and 1000';END IF;
 IF p_objectives IS NULL OR jsonb_typeof(p_objectives)<>'array' THEN RAISE EXCEPTION 'Objectives must be an array';END IF;
 v_count:=jsonb_array_length(p_objectives);IF v_count<1 OR v_count>100 THEN RAISE EXCEPTION 'A unit requires 1 to 100 objectives';END IF;
 IF p_unit_id IS NULL THEN INSERT INTO public.lms_curriculum_units(organization_id,course_id,title,description,sequence,published,created_by) VALUES(v_org,p_course_id,btrim(p_title),nullif(btrim(coalesce(p_description,'')),''),p_sequence,coalesce(p_published,false),auth.uid()) RETURNING id INTO v_unit;
 ELSE SELECT id INTO v_unit FROM public.lms_curriculum_units WHERE id=p_unit_id AND course_id=p_course_id AND organization_id=v_org FOR UPDATE;IF v_unit IS NULL THEN RAISE EXCEPTION 'Unit not found';END IF;UPDATE public.lms_curriculum_units SET title=btrim(p_title),description=nullif(btrim(coalesce(p_description,'')),''),sequence=p_sequence,published=coalesce(p_published,false),updated_at=now() WHERE id=v_unit;DELETE FROM public.lms_learning_objectives WHERE unit_id=v_unit;END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_objectives) LOOP v_seq:=v_seq+1;IF char_length(btrim(coalesce(v_item->>'description',''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Objective % must be 1 to 1000 characters',v_seq;END IF;INSERT INTO public.lms_learning_objectives(organization_id,unit_id,code,description,sequence) VALUES(v_org,v_unit,nullif(btrim(coalesce(v_item->>'code','')),''),btrim(v_item->>'description'),v_seq);END LOOP;
 RETURN v_unit;
END $$;
REVOKE ALL ON FUNCTION public.phase2_save_curriculum_unit(uuid,uuid,text,text,integer,boolean,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.phase2_save_curriculum_unit(uuid,uuid,text,text,integer,boolean,jsonb) TO authenticated;
COMMIT;
