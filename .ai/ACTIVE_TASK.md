# Active Task

> This file tracks the single task currently in flight. Only one task should be active
> at a time. Update it when work starts, when it moves to review, and when it closes.
> The GitHub Issue is the source of truth; this file is a local working copy.

---

## Status

**NONE** — no task is currently active.

Last closed: **2026-09-19 — Team admin password reset + repo completion pass**
(PR #10, branch `feat/team-admin-reset-password`, merged to `main`).

### ⚠️ Carried-over action for the human owner

Two committed SQL migrations are **written but NOT applied**. Agents cannot
run SQL against this project; the owner applies migrations by hand in the
Supabase SQL editor.

1. **`supabase/fix_cross_tenant_admin_rpcs.sql`** — SECURITY. Closes
   cross-tenant account deletion and a privilege-escalation path in
   `admin_delete_staff`, `admin_delete_parent`, `admin_merge_profiles`, and
   adds the missing authorization check to `promote_pending_profile`.
   **These RPCs stay exploitable in production until this is applied.**
2. **`supabase/admin_reset_team_member_password.sql`** — defines
   `admin_reset_user_password`, which the shipped Team page "Reset PW"
   button calls. The button errors until this is applied.

Run each in the Supabase SQL editor, then run the `V1`/`V2`/`V3`
verification queries at the bottom of each file. Run order and dependencies
are documented in each file's header.

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
