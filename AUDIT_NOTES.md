# Audit Notes — Multi-tenant Portal Refactor

This session's work, what was fixed, what to run, and what still needs
attention.

---

## Commits (this session)

| SHA (short) | Summary |
|---|---|
| `76934ea` | fix(rls): resolve S288 student-portal blindness with self-read policies + RPC |
| `8781d57` | feat(roles): expand permissions matrix + canonical Student/Parent/Teacher/Bursar roles |
| `94cb46c` | feat(teacher-scoping): filter attendance & assessments by teacher_assignments |
| `4b004e0` | feat(auth): split login into /login (public), /staff-portal (stealth), /admin-console (stealth) |
| `00dc2f7` | fix(announcements): surface RLS/insert errors on save & publish |

---

## SQL migrations to run — in this order

1. **All prior migrations already in `supabase/`** must be applied to the target
   Supabase project first — this session assumes they are current.
   Notable prerequisites:
   - `multi_tenant_migration.sql` (adds `current_user_org_id()` + `org_memberships`)
   - `report_card_and_portals_migration.sql` (creates `parent_student_links`)
   - `portals_migration.sql` (creates `teacher_assignments`, `parent_students`)
   - `auto_provision_users.sql` (creates the auth users)
   - `tenant_isolation_full.sql` (strict per-org RLS)
   - `cbt_upgrade_migration.sql` (RPCs + assignment table)

2. **`supabase/student_visibility_fixes.sql`** — the new migration this session
   added. **This is REQUIRED to fix S288**. It:
   - Backfills a `profiles` row and an `org_memberships` row for every
     provisioned student, parent and teacher auth user.
   - Adds `get_my_student_context()` and `get_my_parent_children()` RPCs
     (SECURITY DEFINER, safe RLS-bypass).
   - Adds self-read policies on students / report_cards / exam_attempts /
     exam_answers / cbt_exam_assignments / exams / student_scores /
     attendance_records / announcements — plus mirror policies for parents
     reading through `parent_student_links`.
   - Updates `auto_provision_student` / `auto_provision_parent` triggers
     so future rows also get a profile + membership + `organization_id`
     on their `parent_student_links`.
   - Idempotent: safe to re-run.

---

## What was fixed (behavior)

### 1. S288 blindness (critical)
Students provisioned by `auto_provision_users.sql` had NO `profiles`
row and NO `org_memberships` row. Because RLS on almost every table
resolves through `current_user_org_id()` (which reads
`org_memberships`), the RPC returned NULL for these users and every
`.select()` came back empty — including the student's own row.

Fixed by backfilling both rows for every existing student/parent/teacher,
adding self-read policies as belt-and-braces, and updating the client
to call `get_my_student_context()` first (RLS-bypass) before falling
back to direct table lookups.

### 2. Roles & permissions matrix
`APP_FEATURES` went from 12 finance-only keys to ~35 keys covering
every dashboard screen (Finance, Academics, Portals, People,
Communication, Operations, Admin). Grouped by area.

Added `ROLE_PRESETS` with canonical permission sets for **student**,
**parent**, **teacher**, **bursar**. The Roles page renders a
"Recommended roles" block that one-click seeds any of these that
don't yet exist for the org.

All Roles-page mutations (`insert`, `update`, `delete`,
`activity_log.insert`) now stamp `organization_id` and surface errors.

### 3. Teacher scoping
- `dashboard/attendance/page.tsx`: class dropdown now filters by
  `teacher_assignments.class_id` for `membership.role === "teacher"`.
- `dashboard/assessments/page.tsx`: both class AND subject dropdowns
  filter by `teacher_assignments` for teachers.
- `dashboard/teaching/page.tsx`: already filtered by `user.id` — no change.
- `dashboard/cbt/page.tsx`: strict-RLS scoping was landed in the prior
  commit `bb7a1cd`. Left as-is — but see "Remaining work" below.

### 4. Split login pages
Three purpose-built entry points:
- **`/login`** — student + parent, premium light layout, uses
  `public/login-bg-student.svg`.
- **`/staff-portal`** — teacher + admin, deep navy + gold palette,
  uses `public/login-bg-staff.svg`, guards against student/parent
  login attempts (signs them out immediately).
- **`/admin-console`** — platform super-admin only, mono/terminal
  aesthetic, uses `public/login-bg-admin.svg`, runs an `isSuper`
  pre-check after `signInWithPassword` and hard-rejects everyone else.
- **`/auth/login`** now `redirect()`s to `/login` — back-compat
  preserved.
- `AppShell.signOut` routes to `/login`.
- Public site header gains a **Sign in** link before Apply Now,
  styled by `.site-signin-link` in `lib/website/theme.ts`.

### 5. Error surfacing on mutations
- `attendance` — save now checks delete & insert errors.
- `assessments` — save now checks delete & insert errors.
- `announcements` — save & publish now surface errors.
- `roles` — all mutations now surface errors + stamp `organization_id`.

---

## Verified as already correct (no change needed)

- **`dashboard/team/page.tsx`** — already filters `org_memberships` by
  `orgId` and only queries `profiles` by the resulting user IDs. No
  cross-tenant leak.
- **`dashboard/inventory/page.tsx`** — stamps `organization_id`.
- **`dashboard/staff/page.tsx`** — stamps `organization_id`.
- **`dashboard/timetable/page.tsx`** — stamps `organization_id`.
- **`components/layout/AppShell.tsx`** — menu grouping is already
  correct: Teacher's Portal shows Teaching/Attendance/Assessments/CBT,
  Student Portal shows Overview/My Exams/My Results, Parent Portal
  shows Overview/My Children, Platform is `superAdminOnly` gated.

---

## Remaining work / risks (not touched this session)

### Medium priority
1. **`dashboard/leads/page.tsx`** — `website_submissions` mutations
   (`update status`, `update notes`, spam toggle) don't check errors.
   If RLS blocks the update (e.g. if leads are cross-tenant), the UI
   claims success. Suggested: wrap each `.update()` in
   `{ error }` and alert on failure.
2. **`dashboard/staff/page.tsx`** — `insert`/`update` don't surface
   errors. Same pattern as above.
3. **`dashboard/inventory/page.tsx`** — insert/update/stock movement
   flows don't surface errors.
4. **`dashboard/timetable/page.tsx`** — timetable entry insert
   already captures `error` on line 144 but only `console.warn`s it;
   should `alert`.
5. **`dashboard/parent-portal/page.tsx`** — consider calling
   `get_my_parent_children()` RPC as the primary child-lookup path
   (mirrors the student-portal fix in `76934ea`).
6. **`dashboard/my-exams/page.tsx`** — already resolves by
   `profile_id`; add the RPC as a first-try like the student-portal
   for defense in depth.

### Low priority / polish
7. **`AuthContext.tsx`** — `hasFeature(key)` returns `true` for
   `isAdmin`. Consider adding a `super_admin` gate for the new
   `platform` feature so a regular org admin cannot toggle it via
   the Roles UI (currently the Roles page shows the `platform`
   checkbox as editable for non-admin roles — clicking has no
   effect because the `.platform` module is superAdmin-only in the
   sidebar, but the UI implies it does).
8. **`APP_FEATURES` in Roles UI** — the `admin` role currently
   auto-shows every checkbox as checked. That is fine for now, but
   consider distinguishing "org owner" (always-on all) from an
   editable "admin" role in the future.
9. **CRLF line endings** — the working tree has a large existing
   diff that is pure CRLF churn on files touched by prior work
   (cbt, leads, my-exams, students, AppShell). Not touched this
   session. Consider `.gitattributes` with `* text=auto eol=lf` to
   normalize.

### Risks to be aware of
- **New self-read RLS policies are additive.** In Postgres, multiple
  policies on the same command are OR'd. The tenant policy still
  guards writes; the student self-read policies only add SELECT
  visibility. No write bypass introduced.
- **`get_my_student_context()` is SECURITY DEFINER.** It only
  returns rows where `s.profile_id = auth.uid()`, so a compromised
  auth token can only see its own student row — same trust boundary
  as before.
- **`/admin-console` pre-check happens *after* password auth.** A
  wrong-role user is signed in and immediately signed out. Their
  password is verified either way; if a super_admin's credential
  leaks, this page does not add new attack surface.
- **Provisioned student email format `<code>@student.local`** — the
  `.local` TLD is reserved; Supabase Auth is happy with it because
  no verification email is sent. Keep it that way (do not enable
  email confirmation on the student flow).

---

## Files added/modified this session

Added:
- `supabase/student_visibility_fixes.sql`
- `src/app/login/page.tsx`
- `src/app/staff-portal/page.tsx`
- `src/app/admin-console/page.tsx`
- `public/login-bg-student.svg`, `login-bg-staff.svg`, `login-bg-admin.svg`
- `AUDIT_NOTES.md` (this file)

Modified:
- `src/lib/types/index.ts` — `APP_FEATURES` expanded, `ROLE_PRESETS` added
- `src/app/dashboard/roles/page.tsx` — grouped matrix, seeding, error handling
- `src/app/dashboard/attendance/page.tsx` — teacher scoping + error handling
- `src/app/dashboard/assessments/page.tsx` — teacher scoping + error handling
- `src/app/dashboard/announcements/page.tsx` — error surfacing
- `src/app/dashboard/student-portal/page.tsx` — RPC-first student lookup
- `src/app/auth/login/page.tsx` — replaced with redirect stub
- `src/components/layout/AppShell.tsx` — signOut → /login
- `src/components/website/SitePage.tsx` — Sign in link in header
- `src/lib/website/theme.ts` — `.site-signin-link` styling

---

## School-scoped login (Round 3)

### What shipped

- **URL shape.** Every school now has a canonical sign-in URL:
  `https://<platform>/s/<school-slug>/login`. The header of the school's
  public website already points here. Old links to `/login` still work as
  the generic entry.
- **One form, no role picker.** Students enter their code (e.g. `S288`),
  parents/teachers/admins enter their email. Password is a normal password.
- **Role resolved server-side** via the new
  `resolve_login_context(p_slug text)` RPC. It walks:
  1. `org_memberships` (owner/admin/staff → admin, teacher → teacher,
     parent → parent, student → student)
  2. `staff_members.user_id` / `teacher_assignments.user_id` → teacher
  3. `students.profile_id` in that org → student
  4. `parent_profiles.profile_id` linked to a student in that org → parent
- **Wrong-school session is killed.** If the account is not attached to
  the school in the URL, we `signOut()` immediately and show
  "This account is not attached to <School Name>."
- **Redirect map (client-side, `router.replace`):**
  admin → `/dashboard`, teacher → `/dashboard/teaching`,
  student → `/dashboard/student-portal`, parent → `/dashboard/parent-portal`.
- **Pending gate softened.** `dashboard/layout.tsx` no longer forces
  `/auth/pending` for a legitimate role (student/parent/teacher/admin/etc.)
  with an `organization_id`. The new SQL also flips every approval-shaped
  column (`active`, `approved`, `is_approved`, `status`, `account_status`)
  for anyone whose role can be verified in some org.
- **Safety-net signup trigger.** `handle_new_user_school_binding` fires
  `AFTER INSERT ON auth.users`: a new user whose email matches a
  `students.guardian_email` gets a `parent_profiles` row, links to every
  child in the same org, and an `org_memberships` row. A new user whose
  email matches a `staff_members.email` gets the teacher wiring.
- **Middleware.**
  - Unauth visit to `/dashboard/*` → redirect to `/s/<slug>/login` when we
    know the slug (from an `sf_last_school` cookie set on successful login,
    or the `Referer` header). Otherwise `/login`.
  - Auth visit to `/s/<slug>/login` → calls `resolve_login_context` and
    forwards to that role's portal, no form flash.
- **Passthroughs.** `/s/<slug>/dashboard/...` redirects to `/dashboard/...`
  so old bookmarks still work. `/s/<slug>/logout` signs out and returns to
  the school login.

### Not done this round (explicit follow-ups)

- The dashboard tree itself is **not** re-parented under `/s/[slug]/...`.
  Once signed in, the URL is still `/dashboard/...`. Re-parenting would
  touch every internal link across the app and is a separate PR.
- `handle_new_user_school_binding` handles the "user signed up themselves"
  edge case. Most parents/teachers are still created by the existing
  `auto_provision_parent` / admin-added-teacher flows.

### How a super-admin invites a new school

1. Create the organization (via `/admin-console`), set `slug` to a short
   lowercase identifier (`grant-schools`, `st-marys`, etc.).
2. Publish the school's website — that also gives them their `/s/<slug>`
   URL.
3. Share `https://<platform>/s/<slug>/login` as the school's single sign-in
   entry point. Students, parents, teachers and admins all use it; the RPC
   sorts them into the right portal.

### SQL to run

`supabase/school_scoped_login.sql`. Idempotent. Ends with a verifier
`SELECT` showing counts of each resolvable role.
