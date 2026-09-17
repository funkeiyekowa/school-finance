# Decisions Log

> Records architectural and design decisions made during development.
> Captures the reason at the time so future agents do not relitigate settled choices.
> Ordered newest-first.

---

## Format

```
### <YYYY-MM-DD> — <Short title>
- **Context:** What situation prompted this decision.
- **Decision:** What was chosen.
- **Reason:** Why this was the right call given constraints.
- **Alternatives considered:** What else was on the table.
- **Consequences:** What this forecloses or enables.
- **Issue / PR:** #<number> (if applicable)
```

---

## Log

### 2026-09-17 — Multi-agent protocol established
- **Context:** Development spans Notion Claude (planning), Claude Code (implementation),
  and Codex (review). A coordination mechanism was being established.
- **Decision:** Notion Claude plans work and prepares GitHub Issues. GitHub Issues and
  Pull Requests are the implementation handoff mechanism between agents. `.ai/` files
  hold lightweight supporting state (working notes, checklists, decision log). Human
  approval is required for merge to `main`, production deployment, and all high-risk
  changes (database schema, RLS, auth, financial records, student/parent data).
- **Reason:** GitHub Issues and PRs keep implementation-level handoffs co-located with
  the code and are accessible to all agents without additional tooling. Notion Claude's
  planning role is intentionally upstream of this — Notion is part of the workflow,
  not a replacement for it.
- **Alternatives considered:** Tracking all state solely in `.ai/` files (rejected —
  no review or comment mechanism). Collapsing planning into Claude Code's role
  (rejected — independent planning catches scope creep before implementation starts).
- **Consequences:** Agents must open or update a GitHub Issue before starting any
  non-trivial implementation. `.ai/` files are advisory, not authoritative. The code
  and the GitHub Issue are the source of truth.
- **Issue / PR:** N/A (protocol setup)

---

### Prior decisions (from AUDIT_NOTES.md — carried forward for continuity)

- **S288 fix pattern:** RPC-first lookup (`get_my_student_context()`,
  `get_my_parent_children()`) before direct table query, to tolerate missing
  `org_memberships` rows for provisioned users.
- **Three login entry points by design:** `/login` (students/parents), `/staff-portal`
  (teachers/admins), `/admin-console` (super-admin). Do not collapse these.
- **`SUPABASE_SERVICE_ROLE_KEY` never in `vercel.json`:** Runtime secret; lives only
  in the Vercel dashboard. `NEXT_PUBLIC_*` keys go in `vercel.json` because they are
  inlined at build time and the publishable key is safe to commit.
- **RLS OR-combining:** Never add a second permissive policy to narrow access.
  Replace the existing policy in place, and keep gating migrations last in run order.
- **Manual migrations:** SQL is applied by the human owner in the Supabase SQL editor.
  AI agents deliver idempotent `.sql` files with explicit run-order instructions.
