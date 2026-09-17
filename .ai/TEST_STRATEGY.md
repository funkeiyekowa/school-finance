# Test Strategy

> Describes what is tested, how, and what coverage gaps exist.
> Updated when new test files are added or coverage changes materially.

---

## Test runner

Tests use `tsx` (TypeScript executor) to run `.test.ts` files directly — no Jest, Vitest,
or other framework. Each test file is a standalone script that throws on failure.

```bash
npm run test          # run all test suites
npm run typecheck     # tsc --noEmit (catches type errors before tests)
npm run lint          # eslint --max-warnings=0
```

---

## Current test suites (from package.json `scripts`)

| Script | File(s) | What it covers |
|---|---|---|
| `test:alerts` | `src/lib/alerts/dedup.test.ts` + `matcher.test.ts` | SMS/email alert deduplication and bank-alert pattern matching |
| `test:website` | `test.config.ts` (runs `contrast.test.ts`, `theme-validator.test.ts`, `security.test.ts`) | Website Studio theme contrast, validation rules, and security constraints |
| `test:tenant-spec` | `src/lib/tests/tenant-isolation.test.ts` | Tenant isolation logic (org scoping correctness) |
| `test:authorization` | `src/lib/tests/phase1-authorization.test.ts` | Role-based access control guards |
| `test:phase2` | `src/lib/tests/phase2-reliability.test.ts` | Phase 2 reliability patterns (error surfacing, mutation checks) |
| `test:login-context` | `src/lib/tests/login-context.test.ts` | Login flow context and role routing |
| `test:timetable` | `src/lib/tests/timetable-authorization.test.ts` | Timetable feature authorization |
| `test:timetable-setup` | `src/lib/tests/timetable-setup.test.ts` | Timetable initial setup constraints |

---

## What is NOT tested (known gaps — from AUDIT_NOTES.md backlog)

- `dashboard/leads/page.tsx` — mutation error surfacing untested.
- `dashboard/staff/page.tsx` — insert/update error handling untested.
- `dashboard/inventory/page.tsx` — stock movement error handling untested.
- `dashboard/parent-portal/page.tsx` — RPC-first child lookup not yet tested.
- `dashboard/my-exams/page.tsx` — RPC-first fallback path not yet tested.
- UI/browser tests — no Playwright or Cypress suite exists. The CI `build` step is
  the only end-to-end signal for Next.js rendering.

---

## Testing rules for new work

1. **Any new utility function** in `src/lib/` must have a corresponding `.test.ts` file.
2. **RLS-adjacent logic** must be covered by a tenant-isolation test or a new named
   test file registered in `package.json`.
3. **New API route handlers** must be covered by at minimum a contract test (request
   shape + response shape).
4. **No test framework changes** without a GitHub Issue and human approval — `tsx` is
   the current standard; do not introduce Jest/Vitest without discussion.
5. **Tests must pass in CI** — the `CI: true` env is set; tests may not open real
   network connections or depend on `.env.local`.

---

## CI environment (from `.github/workflows/ci.yml`)

```yaml
CI: true
NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY: ci-placeholder-anon-key
```

Tests must not require a live Supabase instance. The URL is a localhost placeholder.
`SUPABASE_SERVICE_ROLE_KEY` is intentionally absent in CI — tests must not call
service-role code paths.
