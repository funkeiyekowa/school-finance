-- Student dashboard + results RPCs.
-- Idempotent. Run AFTER rls_role_scoped_access.sql and student_visibility_fixes.sql.
-- Adds no policies, so it cannot widen RLS. Both functions are SECURITY DEFINER
-- and only ever resolve rows for the caller's own student record.

-- ---------------------------------------------------------------------------
-- 0. One-time backfill: legacy attempts stored marks but no percentage, which
--    is why the portal showed 0.0 / 0.3%.
-- ---------------------------------------------------------------------------
update public.exam_attempts a
   set percentage = round((a.total_score::numeric / nullif(e.total_marks,0)::numeric) * 100, 2)
  from public.exams e
 where e.id = a.exam_id
   and a.percentage is null
   and a.total_score is not null
   and coalesce(e.total_marks,0) > 0;

-- ---------------------------------------------------------------------------
-- 1. Internal: resolve the caller's student row (profile_id, then guardian_email).
-- ---------------------------------------------------------------------------
create or replace function public._my_student_row()
returns public.students
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v public.students;
  v_email text;
begin
  select * into v from public.students where profile_id = auth.uid() limit 1;
  if v.id is not null then
    return v;
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then
    return v;
  end if;

  select * into v
    from public.students
   where lower(guardian_email) = v_email
     and status = 'active'
   limit 1;
  return v;
end;
$$;

revoke all on function public._my_student_row() from public;
grant execute on function public._my_student_row() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Dashboard payload: student + every visible exam with its resolved state
--    + report cards + stats. One round trip, all rules server-side.
-- ---------------------------------------------------------------------------
create or replace function public.get_student_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_student public.students;
  v_class_key text;
  v_exams jsonb;
  v_cards jsonb;
  v_stats jsonb;
begin
  v_student := public._my_student_row();
  if v_student.id is null then
    return jsonb_build_object('found', false);
  end if;

  -- CLASS MATCH: see §1 decision A. Keep exactly one variant.
  -- (2) fallback used when can_take_exam() is unavailable:
  v_class_key := v_student.grade;

  with my_attempts as (
    select * from public.exam_attempts where student_id = v_student.id
  ),
  visible as (
    select e.*
      from public.exams e
     where e.status = 'published'
       and e.organization_id = v_student.organization_id
       and (
         -- (1) delegate when available:
         -- public.can_take_exam(e.id, v_student.id)
         -- (2) fallback:
         exists (
           select 1 from public.cbt_exam_assignments a
            where a.exam_id = e.id
              and a.student_id = v_student.id
              and (a.available_from is null or a.available_from <= now())
              and (a.available_to   is null or a.available_to   >= now())
         )
         or (
           not exists (select 1 from public.cbt_exam_assignments c where c.exam_id = e.id)
           and (e.class_id is null or e.class_id::text = v_class_key)
         )
       )
  ),
  rolled as (
    select
      v.id, v.title, v.exam_type, v.duration_minutes,
      coalesce(v.total_marks, 0) as total_marks,
      coalesce(v.pass_mark, 0)   as pass_mark,
      coalesce(v.max_attempts,1) as max_attempts,
      coalesce(v.show_answers,false) as show_answers,
      v.starts_at, v.ends_at,
      (select count(*) from my_attempts a
        where a.exam_id = v.id
          and a.status in ('submitted','timed_out','graded'))::int as consumed,
      (select a.id from my_attempts a
        where a.exam_id = v.id and a.status = 'in_progress'
        order by a.started_at desc limit 1) as in_progress_attempt_id,
      (select to_jsonb(x) from (
         select a.id, a.attempt_number, a.total_score, a.percentage, a.passed,
                a.status, a.submitted_at, a.started_at
           from my_attempts a
          where a.exam_id = v.id
            and a.status in ('submitted','timed_out','graded')
          order by coalesce(a.percentage,0) desc, a.submitted_at desc nulls last
          limit 1
       ) x) as best_attempt
      from visible v
  )
  select jsonb_agg(
           jsonb_build_object(
             'id', r.id,
             'title', r.title,
             'exam_type', r.exam_type,
             'duration_minutes', r.duration_minutes,
             'total_marks', r.total_marks,
             'pass_mark', r.pass_mark,
             'max_attempts', r.max_attempts,
             'show_answers', r.show_answers,
             'starts_at', r.starts_at,
             'ends_at', r.ends_at,
             'attempts_used', r.consumed,
             'attempts_left', greatest(0, r.max_attempts - r.consumed),
             'in_progress_attempt_id', r.in_progress_attempt_id,
             'best_attempt', r.best_attempt,
             'state',
               case
                 when r.in_progress_attempt_id is not null then 'in_progress'
                 when r.max_attempts - r.consumed <= 0      then 'exhausted'
                 when r.starts_at is not null and r.starts_at > now() then 'upcoming'
                 when r.ends_at   is not null and r.ends_at   < now() then 'closed'
                 else 'available'
               end
           )
           order by r.starts_at nulls last, r.title
         )
    into v_exams
    from rolled r;

  select jsonb_agg(
           jsonb_build_object(
             'id', rc.id, 'term', rc.term,
             'average_score', rc.average_score,
             'grade_overall', rc.grade_overall
           ) order by rc.term
         )
    into v_cards
    from public.report_cards rc
   where rc.student_id = v_student.id
     and rc.published = true;

  select jsonb_build_object(
           'available',      count(*) filter (where x.state = 'available'),
           'in_progress',    count(*) filter (where x.state = 'in_progress'),
           'upcoming',       count(*) filter (where x.state = 'upcoming'),
           'completed',      coalesce(sum(x.attempts_used), 0),
           'avg_percentage', round(avg(x.pct) filter (where x.pct is not null), 1)
         )
    into v_stats
    from (
      select (e->>'state') as state,
             (e->>'attempts_used')::int as attempts_used,
             ((e->'best_attempt')->>'percentage')::numeric as pct
        from jsonb_array_elements(coalesce(v_exams, '[]'::jsonb)) e
    ) x;

  return jsonb_build_object(
    'found', true,
    'student', jsonb_build_object(
      'id', v_student.id,
      'student_code', v_student.student_code,
      'full_name', v_student.full_name,
      'grade', v_student.grade,
      'status', v_student.status,
      'must_change_password', coalesce(v_student.must_change_password, false)
    ),
    'exams', coalesce(v_exams, '[]'::jsonb),
    'report_cards', coalesce(v_cards, '[]'::jsonb),
    'stats', v_stats
  );
end;
$$;

revoke all on function public.get_student_dashboard() from public;
grant execute on function public.get_student_dashboard() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Results payload: per-subject scores (denominator = only the assessment
--    types actually scored for that subject), CBT attempts, all-time attendance.
-- ---------------------------------------------------------------------------
create or replace function public.get_student_results()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_student public.students;
  v_subjects jsonb;
  v_types jsonb;
  v_attempts jsonb;
  v_attendance jsonb;
begin
  v_student := public._my_student_row();
  if v_student.id is null then
    return jsonb_build_object('found', false);
  end if;

  select jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'short_code', t.short_code,
           'max_score', t.max_score) order by t.sort_order)
    into v_types
    from public.assessment_types t
   where t.active = true;

  with sc as (
    select s.subject_id, s.assessment_type_id, s.score, s.term
      from public.student_scores s
     where s.student_id = v_student.id
  ),
  per_subject as (
    select
      sub.id, sub.name, sub.short_code,
      sum(coalesce(sc.score,0))                as total,
      sum(coalesce(at.max_score,0))            as max_total,
      jsonb_agg(jsonb_build_object(
        'assessment_type_id', sc.assessment_type_id,
        'score', sc.score) order by at.sort_order) as breakdown
      from sc
      join public.subjects sub on sub.id = sc.subject_id
      left join public.assessment_types at on at.id = sc.assessment_type_id
     group by sub.id, sub.name, sub.short_code
  )
  select jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'short_code', p.short_code,
           'total', p.total, 'max_total', p.max_total,
           'percentage', case when p.max_total > 0
                              then round((p.total / p.max_total) * 100, 1)
                              else null end,
           'grade', (select g.grade from public.grading_scales g
                      where p.max_total > 0
                        and (p.total / p.max_total) * 100 between g.min_score and g.max_score
                      order by g.sort_order limit 1),
           'breakdown', p.breakdown
         ) order by p.name)
    into v_subjects
    from per_subject p;

  select jsonb_agg(jsonb_build_object(
           'id', a.id, 'exam_id', a.exam_id, 'exam_title', e.title,
           'total_score', a.total_score, 'total_marks', e.total_marks,
           'percentage', a.percentage, 'passed', a.passed,
           'attempt_number', a.attempt_number,
           'submitted_at', a.submitted_at, 'show_answers', coalesce(e.show_answers,false)
         ) order by a.submitted_at desc nulls last)
    into v_attempts
    from public.exam_attempts a
    join public.exams e on e.id = a.exam_id
   where a.student_id = v_student.id
     and a.status in ('submitted','timed_out','graded');

  select jsonb_build_object(
           'total', count(*),
           'present', count(*) filter (where status_code in ('present','late')),
           'percentage', case when count(*) > 0
             then round(100.0 * count(*) filter (where status_code in ('present','late')) / count(*), 0)
             else null end)
    into v_attendance
    from public.attendance_records
   where student_id = v_student.id;

  return jsonb_build_object(
    'found', true,
    'assessment_types', coalesce(v_types, '[]'::jsonb),
    'subjects', coalesce(v_subjects, '[]'::jsonb),
    'attempts', coalesce(v_attempts, '[]'::jsonb),
    'attendance', v_attendance
  );
end;
$$;

revoke all on function public.get_student_results() from public;
grant execute on function public.get_student_results() to authenticated;

-- Verifier
select 'get_student_dashboard' as fn, public.get_student_dashboard() ? 'found' as ok;
