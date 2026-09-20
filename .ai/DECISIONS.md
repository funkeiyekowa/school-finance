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

### 2026-09-19 — Org-scope the admin RPCs rather than patch `_is_org_admin()`
- **Context:** `public._is_org_admin()` has no `organization_id` predicate —
  it answers "is the caller an admin of *any* org?" — and was the sole guard
  on `admin_delete_staff`, `admin_delete_parent` and `admin_merge_profiles`,
  making cross-tenant account deletion and privilege escalation possible.
- **Decision:** Leave `_is_org_admin()` defined but stop relying on it. Each
  function now resolves the *target's* `organization_id` and gates on the
  existing, correctly scoped `is_org_admin(p_org)` from `saas_foundation.sql`.
  `admin_merge_profiles` requires the caller to administer every org either
  profile belongs to.
- **Reason:** `_is_org_admin()` takes no argument, so it cannot be made
  org-aware in place. Dropping it would break a re-run of
  `admin_delete_and_merge.sql`. Reusing `is_org_admin(p_org)` keeps one
  authorization primitive and preserves platform-admin access deliberately
  (that function already returns true for platform admins) rather than as a
  side effect of the missing check.
- **Alternatives considered:** Revoking the RPCs from `authenticated`
  (rejected — breaks the staff/parent admin screens). Adding a second
  permissive guard (rejected — does not narrow anything).
- **Consequences:** A school admin can no longer touch another school's
  people. Multi-org admins are unaffected because `is_org_admin` is checked
  per target org. Must be applied manually before it protects production.
- **Issue / PR:** #10

### 2026-09-19 — Keep `auth_email_exists` open to `anon`
- **Context:** It is `SECURITY DEFINER` over `auth.users`, granted to `anon`,
  and allows platform-wide account enumeration with no rate limit.
- **Decision:** Leave the grant in place; document the exposure instead.
- **Reason:** It backs the pre-login `/auth/forgot-password` flow. Revoking
  `anon` breaks a working user-facing feature. The real remedy — rate
  limiting plus a neutral "if an account exists we've sent a link" response
  — is a product change, not a security patch, and should be decided
  deliberately rather than bundled into a release.
- **Consequences:** Enumeration remains possible until that work is done.
  Tracked in AUDIT_NOTES.md.

### 2026-09-19 — Defer PR #4 out of the release
- **Context:** `codex/cleanup-20260905` (grounded report-card explainer) is 5
  commits ahead of `main` but 81 behind, and touches `AppShell`,
  `students/page.tsx`, `vercel.json` and `package.json` — all heavily changed
  since. Much of its content already landed on `main` independently.
- **Decision:** Do not merge it as part of the 2026-09-19 production release.
- **Reason:** Merging stale, conflict-prone code during a release trades a
  known-good production state for an unreviewed one. Production readiness
  beats feature count.
- **Consequences:** The explainer stays unshipped until someone rebases it
  and reviews it on its own. PR #4 is left open, not closed.

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
