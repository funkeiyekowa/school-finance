# Active Task

> This file tracks the single task currently in flight. Only one task should be active
> at a time. Update it when work starts, when it moves to review, and when it closes.
> The GitHub Issue is the source of truth; this file is a local working copy.

---

## Status

**NONE** — no task is currently active.

Last closed: **2026-09-20 — Team admin password reset + repo completion
pass. COMPLETE and LIVE IN PRODUCTION.**

PR #10 merged as `cf78143`; Vercel deployed that ref to Production at
2026-09-20T04:08:31Z.

| Gate | State |
|---|---|
| Code complete | ✅ |
| typecheck / lint / test / build | ✅ all green @ `cf78143` |
| CI (`verify`) | ✅ green |
| PR #10 | ✅ MERGED (`cf78143`) |
| Security migration applied | ✅ owner-applied 2026-09-20 |
| Password-reset migration applied | ✅ owner-applied 2026-09-20 |
| Production deployed | ✅ `cf78143` |
| Production smoke tested | ✅ all routes 200, 0 console errors |

> Migration status is **as reported by the owner**. The agent environment
> denies every Supabase remote operation, so the V1–V3 output was not
> independently re-read by an agent.

Production verification performed on the real deployment
(`school-finance-oo52c9raj-grant-schools.vercel.app`, ref `cf78143`):
`/`, `/login`, `/staff-portal`, `/admin-console`,
`/auth/forgot-password` all 200; `/dashboard/team` 307 (correct anonymous
auth redirect); login page renders and the Supabase client initialises
with zero console errors. The deployed ref was confirmed to contain the
`admin_reset_user_password` call, the "Reset PW" UI, both migration
files, the ForcePasswordChange `fallbackErr` fix, the RFID `org_id`
stamp, and zero remaining Website Studio `console.log`s.

### Migrations applied (owner, 2026-09-20)

1. **`supabase/fix_cross_tenant_admin_rpcs.sql`** — ✅ applied. Closed the
   cross-tenant account-deletion and privilege-escalation paths in
   `admin_delete_staff`, `admin_delete_parent`, `admin_merge_profiles`, and
   added the missing authorization check to `promote_pending_profile`.
2. **`supabase/admin_reset_team_member_password.sql`** — ✅ applied.
   Defines `admin_reset_user_password`, which the Team page "Reset PW"
   button calls. That button is now live in production as of `cf78143`.

The orphaned migration-history entry `20260912233613` was deliberately
**not** touched during this closeout. See AUDIT_NOTES.md for the
diagnosis and the least-destructive procedure if it is ever reconciled.

---

## Template (copy when starting a task)

```
## Task
- GitHub Issue: #<number> — <title>
- Branch: <branch-name>
- Agent: <Notion Claude | Claude Code | Codex>
- Status: PLANNING | IN PROGRESS | IN REVIEW | BLOCKED | DONE
- Started: <YYYY-MM-DD>
- Target: <YYYY-MM-DD>

## Scope
<!-- One paragraph. What changes, what does not. -->

## High-Risk Areas
<!-- Check any that apply. Each requires human approval before merge. -->
- [ ] Database / RLS / migrations
- [ ] Auth / login / session
- [ ] Financial records (income, expenses, receipts)
- [ ] Student or parent data
- [ ] Attendance records
- [ ] Multi-tenant isolation
- [ ] Secrets / environment variables
- [ ] Production deployment

## Acceptance Criteria
<!-- Bullet list. Each item must be verifiable. -->

## Validation Commands
npm run typecheck
npm run lint
npm run test

## Notes
<!-- Short working notes. Move decisions to DECISIONS.md. -->
```
