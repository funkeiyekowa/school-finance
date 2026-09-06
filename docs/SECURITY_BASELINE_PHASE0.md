# Security Baseline — Phase 0

**Assessment date:** 2026-09-05  
**Repository:** `funkeiyekowa/school-finance`  
**Branch:** `codex/cleanup-20260905`  
**Scope:** static application/security review, repository credential investigation, build/test validation. No production changes were made.

## Phase 0 outcome

The application builds and the existing local checks pass, but the project is **not yet security-clear for Phase 1**. A private ED25519 SSH key was copied into the repository working tree. The key is not present in Git history, but it is still present at the user's SSH path, referenced by the user's SSH config, and successfully authenticates to GitHub. It must be revoked/rotated before treating the credential exposure as resolved.

No key contents are stored in this document.

## SSH credential investigation

- Quarantined artifact: `C:\Temp\school-finance-pre-cleanup-20260905\quarantine\github_claude`.
- The quarantined file has the same SHA-256 file hash and ED25519 fingerprint as `C:\Users\Deji\.ssh\github_claude`.
- Fingerprint: `SHA256:2Lfe55SDAUCfFFXiJHvNX3NWsiJhScOQ3rpgjfiICIc`.
- The user's SSH config contains `IdentityFile ~/.ssh/github_claude` for `github.com`.
- PowerShell history records copying `C:\Users\Deji\.ssh\github_claude` into this repository on 2026-09-03.
- `ssh -T -o BatchMode=yes git@github.com` successfully authenticated as `funkeiyekowa`.
- `git ls-remote origin HEAD refs/heads/main` succeeded over SSH.
- `git ls-files`, `git log --all`, and object-path searches found no tracked or historical copy of `github_claude`.
- Repository workflows, `vercel.json`, and package/deployment configuration contain no reference to this private key.

**Required action:** revoke the corresponding GitHub SSH key and create a replacement outside the repository. This has deliberately not been performed without explicit confirmation. The GitHub account and any other service that accepted this key should be reviewed for recent activity.

## Tenant and organization model

- Supabase Postgres is the application backend.
- `organizations` are tenants; memberships are stored in `org_memberships`.
- `current_user_org_id()` resolves the active organization for the authenticated user.
- Most tenant policies use `organization_id = current_user_org_id()`.
- A user can have multiple memberships; application/API guards select the active default membership.
- Cross-tenant isolation is intended to be enforced by database RLS, not UI navigation.

## Roles

The application role model includes:

- `student`
- `parent`
- `teacher`
- `bursar` / `accountant`
- `staff`
- `editor`
- `admin` / `owner`
- `super_admin`
- `developer` (present in server-side role checks)

Feature permissions are represented by `APP_FEATURES`, role presets, and organization role configuration. Client `RoleGuard` and menu visibility are UX controls only; they are not the security boundary.

## Authentication and server authorization

- Browser authentication uses the Supabase client singleton.
- Server components use the cookie-backed Supabase server client.
- Middleware refreshes dashboard sessions and applies the exam lock.
- `requireActiveSession()` authenticates any active default organization member.
- `requireStaffSession()` gates staff roles and can check organization role permissions.
- Dashboard layout performs a server-side `auth.getUser()` check.
- Sensitive data access is expected to be enforced again by Postgres RLS.

Known validation concern: dashboard fallback provisioning can attempt to create a profile and assign the first profile an admin role. This requires correction in Phase 1; it must not be treated as a safe provisioning boundary.

## RLS and sensitive data surface

The migration directory contains foundational tenant/RLS migrations plus later feature modules. Sensitive tables and modules include:

- students, parents, parent/student links, staff, teams, roles, and memberships
- income, expenses, receipts, vendors, finance and reconciliation data
- payroll components, payroll runs, and payslips
- clinic patient records, visits, medications, vaccinations, and incidents
- LMS courses, lessons, enrollments, progress, quizzes, attempts, answers, and submissions
- library books, loans, reservations
- hostel houses, rooms, beds, allocations, and incidents
- transport routes, vehicles, and student assignments
- assets, assignments, maintenance, and disposals
- procurement requests, orders, receipts, and line items
- exams, exam attempts, answers, proctoring events, and recordings
- communication conversations, messages, attachments, and audit records

High-risk baseline finding: newer modules such as LMS, clinic, payroll, and assets contain tenant-wide `FOR ALL` policies that appear to check organization membership but not role or record ownership. These must be reviewed and replaced in the final Phase 1 migration.

## AI endpoints

Current AI routes:

- `/api/ai/ask`
- `/api/ai/assistant`
- `/api/ai/generate`
- `/api/ai/lms-study-help`
- `/api/ai/org-settings`
- `/api/ai/providers`
- `/api/ai/test`

Staff-only guards exist for generation/provider administration. General assistant routes use active-membership checks and school configuration. The LMS study-help route is student-facing but currently has an ambiguous identity fallback that must be removed in Phase 1. AI usage is currently subject to an in-memory rate limiter rather than a shared global quota.

## Storage and upload configuration

Observed storage surfaces:

- `profile-photos` — server-mediated profile photo uploads
- `website-media` — website media/logo uploads
- `message-attachments` — private message attachments
- `proctoring-recordings` — private exam recordings and signed upload URLs

The photo and proctoring routes construct server-controlled paths. Website media accepts a client-provided folder value and uploads trust the client MIME type; both require hardening in Phase 2.

## Phase 0 verification

- `npm run typecheck` — passed
- `npm run lint` — passed
- `npm run test` — passed runnable alert, website, security, and specification tests
- `npm run build` — passed; 123 routes generated
- Live role/RLS matrix — not run; the existing tenant test specification requires authenticated test users and a live Supabase test setup

## Remaining Phase 0 risks

1. The GitHub SSH credential remains valid and must be revoked/rotated.
2. Sensitive module RLS is not yet proven role-scoped.
3. Live cross-tenant and role-based tests have not yet been executed.
4. First-user admin provisioning is unsafe until corrected.
5. Production deployment and Supabase migrations remain intentionally unchanged.

## Next phase gate

Phase 1 may begin only after the SSH key is revoked/rotated or the user explicitly accepts the documented residual credential risk. Phase 1 will address RLS, server authorization, tenant isolation tests, and the ambiguous LMS identity fallback before any AI feature work.
