# Supabase SQL migrations — run order

There is no migration runner here — every file in this folder is run
manually, once, in the Supabase SQL editor. This file exists because
there are now 60+ of them and getting the order wrong is a real way to
break the app (a function that calls a helper defined in a later file,
an RLS policy that references a table that doesn't exist yet, and so
on — this has happened before: `ai_provider_settings_v2.sql` originally
shipped with its helper functions defined after their callers).

**How this order was built:** it's the order these files were first
written and committed, reconstructed from git history
(`git log --diff-filter=A` against every `supabase/*.sql` file), with
one adjustment where a file's own header comment states an explicit
dependency. It reflects the order this deployment's database was
actually built up in, which is the safest available evidence for how a
fresh database should be built up too. It is **not** a hand-verified
dependency graph of all 64 files against each other — most files have
no stated dependency at all, so treat this as "apply oldest-first,
skip what you've already run" rather than a guarantee that file #40
cannot possibly need something from file #41. Every file is written to
be idempotent (safe to re-run), so re-running an earlier file after a
later one is generally harmless — it's only running something too
*early* that risks an error.

**If you're doing a genuinely fresh deployment**, run every file below
top to bottom, skipping the ones marked optional/one-off/rollback. **If
you're an existing deployment catching up on new files**, just run
whatever you haven't run yet, in this order.

## Run order

1. `schema.sql`
2. `sms_settings_migration.sql`
3. `sms_gateway_status_migration.sql`
4. `dynamic_categories_migration.sql`
5. `student_name_fields_migration.sql`
6. `sms_sender_whitelist_migration.sql`
7. `sms_auto_expense_migration.sql`
8. `email_alerts_migration.sql`
9. `email_alerts_fix_migration.sql`
10. `dedup_archive_migration.sql`
11. `auto_credit_policy_migration.sql`
12. `promotion_system_migration.sql`
13. `multi_tenant_migration.sql`
14. `attendance_migration.sql`
15. `timetable_migration.sql`
16. `assessments_migration.sql`
17. `cbt_migration.sql`
18. `portals_migration.sql`
19. `operations_migration.sql`
20. `automations_migration.sql`
21. `tenant_isolation_enforcement.sql`
22. `saas_foundation.sql` — requires schema.sql, multi_tenant_migration.sql,
    tenant_isolation_enforcement.sql (stated in its own header; all three
    are already above). Central: `is_platform_admin()`, `is_org_admin()`,
    org provisioning, and most later files build on this one.
23. `bootstrap_grant_schools.sql` — fixes an org-visibility bug that
    depends on the RBAC saas_foundation.sql just created.
24. `fix_profile_isolation.sql` — explicitly "Run AFTER saas_foundation.sql".
25. `website_module.sql` — explicitly "Run AFTER saas_foundation.sql".
26. `fix_rls_leaks.sql`
27. `student_finance_module.sql`
28. `website_studio_upgrade_migration.sql` — explicitly "Run AFTER website_module.sql".
    ⚠ Its counterpart `website_studio_upgrade_rollback.sql` is **not** part
    of the forward run order — see "Rollback scripts" below.
29. `fix_setup_issues.sql` — explicitly "Run after saas_foundation.sql".
30. `website_mega_themes.sql` — explicitly "Run AFTER website_module.sql".
31. `website_studio_fixes.sql`
32. `auto_provision_users.sql`
33. `fix_student_login_lookup.sql`
34. `fix_auto_role_assignment.sql`
35. `report_card_and_portals_migration.sql`
36. `cbt_upgrade_migration.sql`
37. `upgrade_grant_schools_site.sql`
38. `fix_auto_approve_users.sql`
39. `set_grant_schools_hero_frameless.sql` — ⚠ one-off data UPDATE for the
    "Grant Schools" demo/pilot school specifically, not a schema
    migration. Skip on a fresh deployment unless you have that same school.
40. `set_grant_schools_hero_frameless_v2.sql` — same caveat as #39.
41. `tenant_isolation_full.sql`
42. `student_visibility_fixes.sql`
43. `fix_parent_provision_on_update.sql`
44. `school_scoped_login.sql`
45. `fix_pending_role_promotion.sql`
46. `platform_settings_migration.sql`
47. `fix_teacher_login_and_password_change.sql`
48. `fix_parent_reset_and_team_sync.sql`
49. `fix_staff_login_and_roles.sql`
50. `rls_role_scoped_access.sql`
51. `cbt_sanitized_questions.sql`
52. `rls_profiles_lockdown.sql`
53. `promotion_add_demoted_column.sql`
54. `error_log.sql`
55. `error_log_pg_cron.sql` — ⚠ optional. Only if you have the pg_cron
    extension enabled (Supabase Pro plan, Database → Extensions). Prunes
    `error_log` on a schedule; skip if you're on the free plan.
56. `admin_delete_and_merge.sql`
57. `fix_staff_type_role_binary.sql`
58. `20260830000000_atomic_org_finance_numbering.sql`
59. `ai_provider_settings.sql` — explicitly "Requires: platform_settings_migration.sql" (#46, already above).
60. `ai_provider_settings_v2.sql` — explicitly "Run order: after ai_provider_settings.sql".
61. `fix_org_slug_edit.sql` — explicitly "after saas_foundation.sql ... and upgrades_2026_08.sql".
    (upgrades_2026_08.sql — see #62 — must run first; if you're following
    this list top-to-bottom that's already the case.)
62. `upgrades_2026_08.sql`
63. `custom_ai_providers.sql` — explicitly "after saas_foundation.sql ... and ai_provider_settings_v2.sql" (both already above).
64. `fix_website_not_found_reason.sql` — explicitly "after website_module.sql" (#25, already above).

> Note: `upgrades_2026_08.sql` (#62) is listed after `fix_org_slug_edit.sql`
> (#61) by first-commit date, but `fix_org_slug_edit.sql`'s own header says
> it needs `upgrades_2026_08.sql` too. Run `upgrades_2026_08.sql` **before**
> `fix_org_slug_edit.sql` regardless of the numbering above — this is the
> one place this list's chronological ordering and a file's stated
> dependency disagree, and the file's own header wins.

## Rollback scripts (do not run as part of a normal setup)

- `website_studio_upgrade_rollback.sql` — reverses
  `website_studio_upgrade_migration.sql` (#28) and **drops draft data and
  custom themes**. Only run this if you're deliberately undoing that
  migration.

## One-off / optional (skip unless they apply to you)

- `set_grant_schools_hero_frameless.sql`, `set_grant_schools_hero_frameless_v2.sql` —
  one-time data updates for a specific school, not schema.
- `error_log_pg_cron.sql` — needs the pg_cron extension (Supabase Pro).

## Adding a new migration

Give it a `-- Run order: after X.sql` (or "Requires:") comment at the
top, same as most files here already do, and add it to the bottom of
this list — that one sentence is what keeps this file honest as more
migrations get added.
