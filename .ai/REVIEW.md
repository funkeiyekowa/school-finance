# Review Checklist

> Used by Codex (independent reviewer) on every PR before human approval.
> Work through each section. Mark items PASS / FAIL / N/A.
> Post findings as inline PR comments with file + line number.

---

## 1. Scope

- [ ] Change matches the GitHub Issue description.
- [ ] No files modified outside the stated scope.
- [ ] No application source changes bundled with orchestration/tooling changes.

## 2. Security

- [ ] No secrets, keys, or credentials in source files or comments.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` not in `vercel.json` or any committed file.
- [ ] No `NEXT_PUBLIC_` prefix on server-only variables.
- [ ] No `eval`, `dangerouslySetInnerHTML`, or dynamic SQL string concatenation introduced.
- [ ] User-supplied input is not passed to shell commands or SQL without parameterization.

## 3. Multi-tenancy / RLS

- [ ] Every new insert/update stamps `organization_id`.
- [ ] Error from `.insert()` / `.update()` is checked and surfaced in the UI.
- [ ] No new permissive policy added to narrow access (must replace in place).
- [ ] Cross-RLS reads use `SECURITY DEFINER` RPCs, not client-side `.select()`.
- [ ] New SQL migration is idempotent (`CREATE OR REPLACE`, `DROP ... IF EXISTS`).
- [ ] Run-order stated relative to `rls_role_scoped_access.sql`.

## 4. TypeScript

- [ ] `npm run typecheck` passes with no errors.
- [ ] No `any` types introduced without a justification comment.
- [ ] No `@ts-ignore` or `@ts-expect-error` introduced.

## 5. Code quality

- [ ] `npm run lint` passes (0 warnings).
- [ ] `npm run test` passes.
- [ ] No dead code or commented-out blocks left in.
- [ ] No console.log / console.warn left in production paths.
- [ ] Existing patterns followed (browser singleton client, server client in server components).

## 6. UI / UX (if applicable)

- [ ] Error states are visible to the user (not silently swallowed).
- [ ] Loading states handled.
- [ ] Tailwind classes follow existing component patterns.

## 7. High-risk sign-off

Required if any of these areas were touched. Human must approve before merge.

- [ ] Database schema / RLS / migrations
- [ ] Auth / session / login flows
- [ ] Financial records (income, expenses, receipts, reconciliation)
- [ ] Student or parent personal data
- [ ] Attendance records
- [ ] Multi-tenant isolation logic
- [ ] Production environment variables

## 8. CI

- [ ] GitHub Actions `ci.yml` jobs all green: lint → typecheck → test → build.

---

## Findings

_Post findings here as: `FILE:LINE — description`. Codex also posts as inline PR comments._

_No findings yet._
