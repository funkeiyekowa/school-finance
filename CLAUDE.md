# PROJECT CONTEXT — Smart & Thrive O/S (repo: `school-finance`)

> **Purpose of this file.** You are an AI assistant that has just been asked to help
> develop this project. Read this whole file first — it tells you what the app is, the
> exact stack, how the database and auth work, how to build/test/deploy, and the
> landmines that will bite you if you don't know them. The specific change I want is at
> the very bottom, under **"YOUR TASK."** Do not invent credentials, table names, or
> schema — ask me or tell me your assumption instead. This is a living document; keep it
> in sync if the project changes.
>
> _Older docs in this repo (README.md, DEPLOY.md, some code comments) still say
> "Next.js 14." That is stale — see the stack section for the authoritative versions._

---

## 1. What this app is

A **multi-tenant school-management + finance SaaS** ("Smart & Thrive O/S"; called
"School Finance Suite" in older docs). One deployment serves many schools
(organizations); every row is scoped to an organization and isolated by
Postgres Row-Level Security (RLS). Originally built for Nigerian schools (fees in
term structures, parent/student portals, SMS bank-alert reconciliation).

Feature areas (each is a route group under `src/app/dashboard/`):

- **Finance** — income, expenses, receipts, reconciliation, student-finance, vendors, reports, analytics.
- **Academics** — assessments, report-cards, CBT (computer-based testing / exams), timetable, attendance, teaching.
- **Portals** — student-portal, parent-portal, my-exams, my-results, my-children (role-scoped self-service views).
- **People** — students, parents, staff, team, roles (permissions matrix), leads.
- **Operations / Comms** — inventory, automations, sms-alerts, announcements, activity log, receipts.
- **Website Studio** — each school gets a public marketing site (`/s/[slug]`, `/site`), edited in `dashboard/website`.
- **Platform** — super-admin-only cross-tenant administration (`admin-console`, `dashboard/platform`).
- **AI helpers** — `dashboard/ai` + `src/app/api/ai` (content generation: taglines, SEO, news).

---

## 2. Tech stack (authoritative — from `package.json`, versions verified in `node_modules`)

- **Next.js `16.3.3`** (App Router) — **not 14**, ignore docs that say otherwise.
- **React `19.2.8`** + React-DOM 19.2.8.
- **TypeScript `^5`** — `tsc --noEmit` must pass; `next.config.mjs` sets `typescript.ignoreBuildErrors: false`, so **type errors fail the production build.**
- **Tailwind CSS `^3.4`** (config in `tailwind.config.ts`), PostCSS.
- **Supabase** — `@supabase/ssr ^0.12`, `@supabase/supabase-js ^2.112`. Postgres + Auth + RLS. This is the entire backend; there is no separate API server.
- **UI/data**: `lucide-react` (icons), `recharts` (charts), `date-fns` (dates), `jspdf` + `jspdf-autotable` (PDF export), `xlsx`/SheetJS (spreadsheet export), `clsx` + `tailwind-merge` + `class-variance-authority` (styling utils).
- **ESLint `9`** flat config (`eslint.config.mjs`); `npm run lint` runs with `--max-warnings=0`.
- **Runtime**: Node `>=20.9`.
- **Hosting**: **Vercel** (auto-deploys on push to `main`). Supabase is the DB.

The app code lives in the **`school-finance/` subfolder** of the repo. Run all `npm`
commands and point your tools at `school-finance/`, not the parent folder.

---

## 3. Repository layout

```
school-finance/
├─ src/
│  ├─ app/                    # Next App Router
│  │  ├─ (public)            # /login, /staff-portal, /admin-console, /auth/*, /s/[slug], /site
│  │  ├─ dashboard/<feature> # one folder per feature area (see §1)
│  │  └─ api/                 # route handlers: ai, sms-webhook, sms-gateway, email-webhook, client-error, platform, alert-test
│  ├─ components/             # ui/, layout/ (AppShell), charts/, auth/, website/, platform/, students/, ai/
│  ├─ lib/
│  │  ├─ supabase/            # client.ts (browser singleton), server.ts, middleware.ts, org-query.ts
│  │  ├─ context/             # AuthContext.tsx  ← roles/permissions live here
│  │  ├─ types/               # index.ts  ← APP_FEATURES + ROLE_PRESETS
│  │  ├─ auth/ guards/ api/   # requireStaff, guards, server helpers
│  │  ├─ alerts/              # SMS/email alert matching + service-role client (service.ts) + tests
│  │  ├─ ai/ finance/ website/ hooks/ errors/ utils/ tests/
│  └─ ...
├─ supabase/                  # ~64 .sql migrations, applied MANUALLY (see §5)
├─ docs/  AUDIT_NOTES.md  DEPLOY.md  PRODUCTION_CHECKLIST.md  README.md
├─ next.config.mjs  vercel.json  tailwind.config.ts  tsconfig.json  eslint.config.mjs
└─ .env.local (gitignored)   .env.local.example
```

**`AUDIT_NOTES.md`** is the most useful in-repo doc: it records recent architectural
decisions, the RLS model, and a **remaining-work backlog** (see §9). Read it too.

---

## 4. Environment variables (values are in `.env.local`, already set correctly)

Referenced by **name only** — do not expect the values in this file, and never paste
the service-role key into a cloud AI or commit it.

| Name | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public (browser) | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public (browser) | Supabase **publishable** key — new-format `sb_publishable_…` (the replacement for the legacy `anon` JWT). Public/safe to expose; access is still gated by RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret, server-only** | New-format `sb_secret_…` (replacement for the legacy `service_role` JWT). Bypasses RLS. Must **never** have a `NEXT_PUBLIC_` prefix, never reach the browser, never be committed. Used only in server code (e.g. `src/lib/alerts/service.ts`). |

> **Key format note.** This project uses Supabase's **new API-key format**
> (`sb_publishable_…` for the browser key, `sb_secret_…` for the server key), not the
> older `anon` / `service_role` **JWTs** (`eyJ…`). If you see a legacy `eyJ…` value in
> an old commit or doc, it's stale — the current keys are the `sb_*` ones in `.env.local`.

**Critical build behavior:** `NEXT_PUBLIC_*` variables are **inlined into the bundle at
build time** (into both client and server code, via static `process.env.X` replacement),
not read at runtime. They must exist in the *build* environment: locally that's
`.env.local`; on Vercel they're supplied by **`vercel.json`'s `build.env`** (committed —
see §9). If `NEXT_PUBLIC_SUPABASE_ANON_KEY` is absent at build, the browser client throws
during static prerender and the build fails. Non-`NEXT_PUBLIC_` vars (e.g.
`SUPABASE_SERVICE_ROLE_KEY`) are **not** inlined and are read at **runtime**, so they must
live in the Vercel dashboard, not `vercel.json`.

---

## 5. Supabase / data model (read before touching the DB)

**Multi-tenancy.** Every tenant is an `organization`. A user's org comes from the
`org_memberships` table, resolved in SQL by `current_user_org_id()`
(`supabase/multi_tenant_migration.sql`). RLS on nearly every table filters by that. If
a user has no `org_memberships` row, RLS returns nothing and their screens look empty —
this was a real prior bug (see AUDIT_NOTES "S288").

**Key SQL helper functions** (know these before editing policies):

| Function | Defined in | Role |
|---|---|---|
| `current_user_org_id()` | `multi_tenant_migration.sql` | The caller's org id, from `org_memberships`. |
| `is_org_admin(org)` | `saas_foundation.sql` | Admin/owner/super-admin check. |
| `is_staff_user()` | `rls_role_scoped_access.sql` | Staff-side (teacher/staff/bursar/admin) check. |
| `my_linked_student_ids()` | `rls_role_scoped_access.sql` | Returns the student ids a user may see (self or parent link). |
| `_reset_policies(table)` | `rls_role_scoped_access.sql` | Drops ALL policies on a table and re-enables RLS. |
| `get_my_student_context()` / `get_my_parent_children()` | `student_visibility_fixes.sql` | `SECURITY DEFINER` RPCs for safe RLS-bypass self-reads. |
| `auto_provision_student` (+ parent/user variants) | `auto_provision_users.sql` | Triggers that create auth users + profiles + memberships. |

**RLS conventions & the #1 gotcha:**

- **Postgres OR-combines multiple *permissive* policies for the same command.** Adding a
  second policy widens access; it never narrows it. To *tighten* a rule you must
  **replace the existing policy in place**, not add another. Any migration that gates a
  policy must be the **last** one to touch that table, or a later re-run of
  `rls_role_scoped_access.sql` (which calls `_reset_policies`) will drop your gate.
- Cross-cutting reads that must bypass RLS (e.g. a teacher grading answers whose rows
  may lack `organization_id`) go through **`SECURITY DEFINER` RPCs** gated by an
  authorization check, not through client-side `.select()`.
- On every insert/update from the client, **stamp `organization_id`** and **check the
  returned `error`** — don't assume success (silent RLS rejections were a recurring bug).

**Migrations.** ~64 `.sql` files in `supabase/`. They are **applied manually by the
project owner in the Supabase SQL editor** — an AI cannot run them. Most are
idempotent (`CREATE OR REPLACE`, `DROP ... IF EXISTS`, backfills). Rough foundational
order: `schema.sql` / `saas_foundation.sql` → `multi_tenant_migration.sql` →
feature migrations (`cbt_*`, `report_card_and_portals_migration.sql`, `portals_migration.sql`,
`student_finance_module.sql`, `website_*`, `sms_*`, `assessments_*`, `attendance_*`, …) →
`tenant_isolation_full.sql` → `rls_role_scoped_access.sql` (the "final word" on core
RLS) → targeted `fix_*.sql`. Naming is mostly descriptive; one file uses a timestamp
prefix (`20260830000000_atomic_org_finance_numbering.sql`). **When you add a migration:
make it idempotent, put it in `supabase/`, and state exactly where in the run order it
must go** (and whether it must run *after* `rls_role_scoped_access.sql`).

---

## 6. Auth & roles

- **`src/lib/context/AuthContext.tsx`** exposes: `profile`, `orgId`, `membership`
  (`{ role, ... }`), and computed flags `canEdit`, `isAdmin`, `isSuper`, plus
  `hasFeature(key)`. `canEdit` = admins/editors/staff/bursar/accountant (**not** teachers);
  teachers are gated separately by their `membership.role`.
- **Permissions matrix** lives in **`src/lib/types/index.ts`**: `APP_FEATURES`
  (~35 feature keys grouped by area) and `ROLE_PRESETS` (canonical sets for
  `student`, `parent`, `teacher`, `bursar`). The Roles screen seeds/edits these.
- **Canonical roles**: `student`, `parent`, `teacher`, `bursar`/`accountant`, `staff`,
  `admin`, `super_admin`.
- **Three login entry points** (by design):
  - `/login` — students + parents.
  - `/staff-portal` — teachers + admins (signs out student/parent attempts).
  - `/admin-console` — platform super-admin only (post-auth `isSuper` gate).
  - `/auth/login` redirects to `/login` for back-compat.
- **Supabase clients**: browser = `src/lib/supabase/client.ts` (module-scope
  **singleton**, throws a clear error if env vars are missing); server components =
  `src/lib/supabase/server.ts` (cookie-based `createServerClient`); `middleware.ts`
  refreshes sessions; service-role client is created server-side in
  `src/lib/alerts/service.ts` and throws if `SUPABASE_SERVICE_ROLE_KEY` is missing.

---

## 7. Build / test / deploy commands (run from `school-finance/`)

```bash
npm install
npm run dev          # local dev server on :3000
npm run build        # production build (fails on TS errors)
npm run typecheck    # tsc --noEmit  ← run this before you finish any change
npm run lint         # eslint, --max-warnings=0 (strict)
npm run test         # tsx unit tests: alerts dedup/matcher, website config, tenant-isolation spec
```

**Deploy:** push to `main` → Vercel builds and deploys automatically. There is no
manual deploy step. Because `NEXT_PUBLIC_*` is inlined at build time, changing those
env values requires a **redeploy**, not just a restart.

---

## 8. Git & collaboration conventions

- Work happens across **two environments** (a local Toronto machine and a cloud/UTC
  environment), so history shows mixed timezones and pushes can arrive from either side.
- **Do not force-push or rewrite shared history.** Prefer `git revert` (a new commit)
  over `git reset --hard`. Pull/rebase before pushing if the branch may have moved.
- Commit messages follow a conventional style (`feat(...)`, `fix(...)`, `perf:`, etc.)
  with a short body explaining *why*.
- **Line endings are normalized to LF** via `.gitattributes` (`* text=auto eol=lf`).
  Don't reintroduce CRLF churn; configure your editor for LF.
- Filenames contain glob-special brackets (e.g. `src/app/dashboard/cbt/[examId]/`).
  When `git add`-ing those from a shell, quote them or use a literal pathspec.

---

## 9. Known landmines & current state (as of 2026-08-30)

1. **Supabase build vars now live in `vercel.json` → `build.env` (committed).** Both
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the `sb_publishable_…`
   key) are set there, so `next build` inlines them. This resolves the earlier failure
   (`Supabase env vars missing. URL: set, Key: MISSING`) that appeared after a commit
   removed the hardcoded Supabase fallbacks from `next.config.mjs`. Trade-off: because the
   key is committed, rotating it means editing `vercel.json` and pushing — acceptable
   since the publishable key is public. **Never** put the `sb_secret_` key here.
2. **The server secret key must be set in the Vercel dashboard (runtime, not committed).**
   `SUPABASE_SERVICE_ROLE_KEY` (now `sb_secret_…`) is **not** inlined and is deliberately
   **not** in `vercel.json`. Server features that use it — SMS/email webhooks, auto-
   provisioning, anything via `src/lib/alerts/service.ts` — need it set in
   **Vercel → Settings → Environment Variables → Production** or they throw at runtime.
   Never commit it.
3. **RLS policy OR-combining** (see §5) — the single most common way to accidentally
   widen access. Replace policies in place; keep gating migrations last.
4. **Manual SQL** — the owner applies migrations by hand in Supabase; you can't run
   them. Deliver idempotent SQL with explicit run-order instructions.
5. **Backlog** in `AUDIT_NOTES.md` "Remaining work": several dashboard screens
   (`leads`, `staff`, `inventory`, `timetable`) don't surface Supabase mutation errors;
   `parent-portal`/`my-exams` could use the RPC-first lookup pattern; a couple of
   Roles-UI polish items. Consult it before starting adjacent work.

---

## 10. Working agreement (how I'd like you to operate)

1. **Read this file and `AUDIT_NOTES.md` before proposing changes.**
2. **Match existing patterns**: browser singleton client, server client in server
   components, `SECURITY DEFINER` RPC for cross-RLS reads, stamp `organization_id`,
   surface errors in the UI.
3. **Before you say a change is done:** `npm run typecheck` must be clean, and
   `npm run lint` should pass. Mention if you couldn't run them.
4. **For any DB change:** provide idempotent SQL in `supabase/`, tell me exactly where
   it goes in the run order (and if it must be *after* `rls_role_scoped_access.sql`),
   and remember I apply it manually.
5. **Small, reviewable commits**; conventional-commit messages; **never force-push**.
6. **Don't guess secrets or schema.** If you need a table/column/env you're unsure of,
   ask or state your assumption explicitly.
7. Keep changes scoped to what I ask; flag risky side effects instead of silently
   expanding scope.

---

## YOUR TASK

<!-- Replace this block with the specific change you want. A good request includes: -->
<!-- • Goal — what outcome you want, in one or two sentences.                         -->
<!-- • Area — which screen(s)/route(s)/table(s) are involved.                         -->
<!-- • Acceptance criteria — how we'll know it's done / how to test it.               -->
<!-- • Constraints — anything to avoid, deadlines, must-not-break areas.              -->

_(Describe the change here.)_
