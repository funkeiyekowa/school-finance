# Database-backed tests

## Why these exist

Every other suite in `src/lib/tests/` is a **static source-text assertion**. They
read `.sql` and `.ts` files and check that strings are present. Concretely:

- `tenant-isolation.test.ts` prints *"20 isolation tests defined"* and asserts
  **nothing**. It is a specification document, not a test.
- `phase1-authorization.test.ts` does `assert.match(migration, /phase1_same_org/)`
  — it proves the migration file *mentions* a function name. "Passes for 7
  personas" means seven persona names were string-matched in a file.
- CI runs with `NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321` and
  `ci-placeholder-anon-key`, with nothing listening on that port.

So before these tests, the security model — RLS, organization isolation, role
gating, the `SECURITY DEFINER` RPCs — had **never been executed**. The suites
here prove behaviour instead of text.

The static suites are deliberately **kept**: they catch a whole class of
regression (someone deleting a policy from a migration) cheaply and without a
database. These run alongside them, not instead of them.

## Safety

The harness is built so it cannot touch production:

1. It reads **separate** env vars (`TEST_SUPABASE_*`) and deliberately does not
   fall back to `NEXT_PUBLIC_SUPABASE_*` or `SUPABASE_SERVICE_ROLE_KEY`, so a
   normal `.env.local` can never aim it at the live project.
2. It hard-refuses any URL containing a known production project ref.
3. It refuses any non-localhost host unless `TEST_ALLOW_REMOTE=yes-i-know`.
4. With no env vars set it **skips cleanly** (exit 0), so `npm test` stays green.

These tests create and delete organizations, users and student rows. Only ever
point them at a local or disposable project.

## Running them

```bash
supabase init            # creates supabase/config.toml (not currently in the repo)
supabase start           # needs Docker running
supabase status          # copy the local service_role and anon keys
```

Then load the schema (see the caveat below) and run:

```bash
TEST_SUPABASE_URL=http://127.0.0.1:54321 \
TEST_SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
TEST_SUPABASE_ANON_KEY=<local anon> \
npm run test:db
```

## ⚠️ The schema is not reproducible from this repository

This is the reason database tests did not exist before, and it needs fixing
separately.

`supabase/README.md` documents a numbered run order of **77 entries / 78 files**.
The repository actually contains **137 `.sql` files**. Of the 51 root-level
files absent from that list, 14 are timestamped (so their order is implied by
the filename) but **37 are not**, and they include whole feature modules:

```
lms_module.sql          clinic_module.sql       library_module.sql
payroll_module.sql      hostel_module.sql       transport_module.sql
assets_module.sql       procurement_module.sql  broadcast_channels_module.sql
class_teacher_allocation_module.sql             photo_uploads_module.sql
...and 26 more
```

`supabase/migrations/` holds only 8 files, so `supabase db reset` produces a
schema nowhere near production.

Until that run order is completed, the only way to get a schema that matches
production is to dump it (structure only, no rows):

```bash
supabase db dump --schema public -f schema.sql   # read-only; needs Docker
psql "$LOCAL_DB_URL" -f schema.sql
```

Reconstructing the schema by guessing an order is worse than having no tests:
the tests would pass against a schema that is not the one running in
production, which is false confidence.

## What is covered so far

`tenant-isolation.db.test.ts` — builds two real organizations, creates real auth
users, **signs them in** so every assertion runs under that user's own JWT with
RLS applied as in the browser, then asserts:

- an admin can read their own org's students, and **cannot** read another org's
  — including by direct row id
- a student can read their own record and **cannot** read another org's
- cross-org `INSERT` and `UPDATE` are refused
- a student cannot promote themselves to admin
- an anonymous caller can read no students and no organizations
- `current_user_org_id()` resolves per-caller and differs between orgs
- `is_org_admin(other_org)` is **false** — the exact guard whose absence caused
  the cross-tenant vulnerabilities fixed in `fix_cross_tenant_admin_rpcs.sql`

## Still to add once a database is available

Personas and flows from the audit that are not yet covered: parent→linked-child
access, teacher class scope, finance role gating, the admin password-reset RPC,
and the `SECURITY DEFINER` RPCs introduced by PRs #11/#12/#13
(`admin_reset_user_password`, `enrol_my_child_in_course`,
`list_courses_for_my_child`, `admit_application`) — each needs both a positive
and a negative authorization case plus a cross-tenant case.
