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

_No entries yet. First handoff will be recorded here._

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
