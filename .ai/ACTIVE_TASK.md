# Active Task

> This file tracks the single task currently in flight. Only one task should be active
> at a time. Update it when work starts, when it moves to review, and when it closes.
> The GitHub Issue is the source of truth; this file is a local working copy.

---

## Status

**NONE** — no task is currently active.

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
