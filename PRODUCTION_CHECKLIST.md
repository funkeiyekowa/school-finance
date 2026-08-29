# Production Readiness Checklist

Written to be run through end-to-end before every launch (a new school
onboarding, a fresh region, or a domain change), and again quarterly.
Each item is a real check with an expected outcome, not an aspiration.

---

## 1. Environment variables

Every one of these must be set on the deploy target (Vercel project, or
your host). Missing values here are the top cause of a "silently
broken" build — the app compiles but a route quietly errors at runtime.

| Variable                          | Where used                                       | Notes                                                        |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`        | Every Supabase call (browser + server)           | Must be the production project URL.                          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Browser Supabase client                          | Safe to expose; rotates when Supabase project keys rotate.   |
| `SUPABASE_SERVICE_ROLE_KEY`       | `createServiceClient()` in webhooks + platform   | **Never** prefix with `NEXT_PUBLIC_`. Rotate on staff churn. |
| `NEXT_PUBLIC_PLATFORM_HOST`       | Multi-tenant subdomain resolution                | e.g. `schoolfinance.ng`. Blank in single-tenant deploys.     |
| `NEXT_PUBLIC_SENTRY_DSN`          | Optional Sentry forwarding in `logError`         | Only needed if Sentry is installed.                          |

Verification: `curl -sf https://<host>/api/sms-webhook` — should return
the JSON self-doc. If it 500s, the service role key is missing.

## 2. Database migrations

Run these in the Supabase SQL editor **in order**. All are idempotent;
re-running is safe.

Baseline (already applied on any live deployment; re-check by running):

- `supabase/multi_tenant_migration.sql`
- `supabase/tenant_isolation_full.sql`
- `supabase/rls_role_scoped_access.sql`
- `supabase/cbt_sanitized_questions.sql`
- `supabase/rls_profiles_lockdown.sql`

Bucket C / D additions:

- `supabase/promotion_add_demoted_column.sql`
- `supabase/error_log.sql`

After applying, verify the tenant isolation is intact:

```sql
SELECT public.verify_tenant_isolation();
```

## 3. RLS spot-check

Runs monthly, and always right after a schema migration.

Sign in as a student user (see the test user in `AUDIT_NOTES.md`) and
attempt each of the following from the browser console:

```js
const s = supabase; // pre-provisioned client in dev tools
await s.from("profiles").select("id").limit(1000);        // expect: 1 row (self)
await s.from("students").select("id").limit(1000);        // expect: 1 row (self)
await s.from("income_entries").select("id").limit(1000);  // expect: 0 rows
await s.from("expense_entries").select("id").limit(1000); // expect: 0 rows
await s.from("staff_members").select("id").limit(1000);   // expect: 0 rows
await s.from("questions").select("id").limit(1000);       // expect: 0 rows
await s.rpc("get_attempt_questions", { p_attempt: <uuid> });
// expect: choices are shuffled, no is_correct or answer_text fields
```

If any expected-0 query returns rows, treat it as a P0 incident. Roll
back the offending migration and re-run tenant_isolation_full.sql.

## 4. Secrets rotation

Every 90 days, and immediately on staff departure:

1. `SUPABASE_SERVICE_ROLE_KEY`: rotate in Supabase dashboard, update in
   Vercel, redeploy. Old key becomes invalid on rotation, so windowing
   a downtime notice is wise.
2. `school_settings.sms_webhook_secret` and `school_settings.email_webhook_secret`:
   rotate from Setup → SMS Alerts / Email Alerts. Update the SMS
   Gateway app config and the Gmail Apps Script property so they
   present the new secret.
3. `organizations.join_code`: rotate from Team → Invite → Regenerate
   whenever a former staff member had access to it.

Recording the rotation date in an internal doc is enough; there's no
automated reminder yet.

## 5. Backups

Supabase-managed daily backups are on by default (Pro tier). Verify:

- Supabase dashboard → Database → Backups: at least one snapshot in
  the last 24 hours.
- Point-in-time recovery is enabled (Pro tier feature).

Restore verification runs quarterly:

1. Provision a scratch project on Supabase.
2. Restore the most recent snapshot into it.
3. Point a local `.env.local` at the scratch project and boot the
   app.
4. Confirm you can sign in, see the org, and open the dashboard.
5. Delete the scratch project.

This exercises both the backup and the restore path — the two failure
modes that only ever surface at the worst moment.

## 6. Rate-limit + error-log health

The public webhooks (`/api/sms-webhook`, `/api/email-webhook`) are
rate-limited per source IP. Trip events land in `public.error_log`.

Weekly check:

```sql
SELECT source, severity, count(*)
  FROM public.error_log
 WHERE created_at > now() - interval '7 days'
 GROUP BY source, severity
 ORDER BY 3 DESC;
```

Expected shape: mostly zero rows, or a small number of `warn` entries
that correlate with a known caller (e.g. someone testing an integration).
A spike of `warn` from `sms-webhook` with `Rate limit exceeded` or
`Unauthorized` messages is the shape of an integration misconfiguration
or, less commonly, a probing attempt. Investigate.

Prune old rows (retain 90 days by default) with:

```sql
SELECT public.prune_error_log(90);
```

Best run from a scheduled Supabase function; a monthly manual run is
acceptable in the interim.

## 7. Automation runner

The automations UI is a preview until a runner is wired. If your
launch relies on automated fee reminders or attendance-alert emails:

- Deploy either a Supabase edge function or a pg_cron job that reads
  `public.automation_rules` where `enabled = true`, evaluates the
  configured trigger + conditions, executes the actions, and appends
  a row to `public.automation_logs`.
- Until then, the banner on `/dashboard/automations` warns admins.

## 8. Feature flags and modules

`platform_settings.enabled_modules` and per-org `module_activations`
gate access to features across roles. Before onboarding a new school,
verify the modules they've paid for are enabled:

```sql
SELECT * FROM public.module_activations WHERE organization_id = '<uuid>';
```

## 9. Domains

Custom domains: after adding one in Website Studio → Domains, verify:

1. DNS records match the panel exactly.
2. In Vercel (or your host), add the domain to the project so a cert
   is issued.
3. Mark the domain verified in the Studio.
4. Load the site from that host and confirm the correct school renders
   (not a fallback / landing page).

## 10. Sign-off

- [ ] All env vars set
- [ ] All migrations applied and verify_tenant_isolation returns OK
- [ ] Live RLS probe passes (item 3)
- [ ] Secrets rotated within 90 days
- [ ] Backup snapshot exists in the last 24 hours
- [ ] Quarterly restore exercised in the last 90 days
- [ ] `error_log` weekly review clean
- [ ] Automation runner deployed if automations are relied on
- [ ] Per-org modules provisioned
- [ ] Custom domains verified and resolving

Sign-off owner and date go in your ops log.
