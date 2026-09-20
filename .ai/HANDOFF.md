# Handoff Log

> Records every handoff between agents. Newest entry at the top.
> The GitHub Issue and Pull Request are the authoritative handoff mechanism;
> this file is a local summary for context continuity.

---

## Format

```
### <YYYY-MM-DD> — <From> → <To>
- Issue / PR: #<number>
- Branch: <branch-name>
- Summary: <one sentence — what was done>
- State left in: <what is ready for the next agent>
- Open questions: <anything unresolved>
- Blockers: <anything stopping the next agent>
```

---

## Log

### 2026-09-19 — Claude Code → Human
- Issue / PR: #10 (`feat(team): admin reset password for any team member`)
- Branch: `feat/team-admin-reset-password` → merged to `main`
- Summary: Closed out the orphaned, uncommitted Team password-reset work,
  then ran a repository-wide completion audit and fixed what it surfaced.
- State left in:
  - **Shipped to production** (Vercel auto-deploys `main`): the Team
    "Reset PW" UI; a fix for a password-change modal that could trap a user
    permanently; a broken RFID card assignment (missing `org_id`); silent
    write failures in Settings, parent↔child links and lesson progress; two
    `console.log`s leaking the tenant `orgId` to the browser console; and
    removal of a committed long-lived production anon JWT from
    `scripts/e2e-tests.mjs` that made the suite silently target production.
  - **Written, committed, NOT applied:** `fix_cross_tenant_admin_rpcs.sql`
    and `admin_reset_team_member_password.sql`. See ACTIVE_TASK.md.
  - Validation: typecheck, lint (0 warnings), the full `npm run test` suite
    and `next build` all green; CI `verify` green on the PR.
- Open questions: whether Automations and SMS/email broadcast should be
  feature-flagged until their backends exist (both are shipped but inert —
  see AUDIT_NOTES.md).
- Blockers: **agents cannot apply SQL to this project.** The two migrations
  above need the owner. Until `fix_cross_tenant_admin_rpcs.sql` is applied,
  three admin RPCs remain cross-tenant exploitable in production.

---

## Agent Roles (quick reference)

| Agent | Role |
|---|---|
| **Notion Claude** | Planning, architecture, issue creation, spec writing |
| **Claude Code** | Local implementation, typecheck, lint, test, PR creation |
| **Codex** | Independent code review, finding defects before merge |
| **Human** | Approves high-risk changes, applies SQL migrations, merges to main, deploys |

## Handoff Triggers

- Notion Claude → Claude Code: Issue is written, acceptance criteria are clear, no open architecture questions.
- Claude Code → Codex: PR is open, CI passes (lint + typecheck + test + build), description is complete.
- Codex → Claude Code: Review is posted, defects listed with file + line.
- Claude Code → Human: All Codex findings addressed, CI green, high-risk checklist completed.
- Human → Notion Claude: Merge and deploy confirmed. Document outcome in DECISIONS.md.
