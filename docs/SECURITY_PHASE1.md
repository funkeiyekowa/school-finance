# Phase 1 — Critical Security Foundation

This phase is implemented on the feature branch and has not been deployed or applied to production.

## Changes

- Added `supabase/20260905120000_phase1_security_enforcement.sql` as the final reconciliation migration. It fails closed when foundational helpers or sensitive module tables are missing, resets permissive policies, enforces organization boundaries, applies role/ownership scopes, and protects SECURITY DEFINER LMS/statistics RPCs with authorized wrappers.
- Added a database write trigger guard for sensitive modules so SECURITY DEFINER operations cannot silently bypass caller authorization.
- Removed first-user administrator bootstrap from the dashboard layout; missing profiles now go to trusted pending provisioning.
- Added server-side guards to sensitive dashboard route groups (finance, student finance, payroll, operations, clinic, LMS, staff/admin settings, and AI administration).
- `/api/ai/lms-study-help` now requires an active student membership and the student's exact `students.profile_id` in the active organization. The guardian-email fallback is removed.
- LMS clients use guarded RPCs and sanitized quiz questions; direct student access to answer keys is blocked.
- Added static Phase 1 authorization contract tests and included them in `npm test`.

## Migration order and operational boundary

Apply the migration manually in Supabase SQL Editor only after all existing migrations, including `tenant_isolation_full.sql`, `rls_role_scoped_access.sql`, `rls_finance_permission_scope.sql`, feature modules (LMS/clinic/payroll/assets/library/hostel/transport/procurement), and the communication module. It must remain the last policy migration. Do not apply it to production as part of this phase without an explicit deployment decision.

The migration is idempotent and contains a verification query at the end. It was reviewed statically, but a live SQL lint/apply was not possible because no local or linked Supabase database was available in this environment.

## Verification status

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — passed, including the Phase 1 contract test.
- `npm run build` — passed (123 routes).
- Live role/tenant matrix with two organizations and Student, Parent, Teacher, Bursar, Staff, Admin, and Super Admin accounts — still required.

The static contract test proves that the required authorization contracts remain present; it does not claim that Postgres RLS has been applied or that live accounts can cross tenant boundaries.

## Explicit residual risk

The exposed GitHub SSH credential remains valid and unchanged by explicit user instruction. No revoke, rotation, replacement, SSH config change, or unrelated credential change was performed. This is a documented outstanding security risk for future remediation.
