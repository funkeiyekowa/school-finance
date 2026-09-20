/**
 * Database-backed test harness.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every "authorization" and "tenant isolation" suite in this repo today is a
 * static source-text assertion: it reads a .sql file and checks a string is
 * present. `tenant-isolation.test.ts` prints "20 isolation tests defined" and
 * asserts nothing at all. CI runs with
 * NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 and a placeholder anon key,
 * so no existing test has ever reached a database.
 *
 * That means the security model — RLS, org isolation, role gating, the
 * SECURITY DEFINER RPCs — has never been *executed*. This harness makes
 * database-backed tests possible so we can prove behaviour rather than text.
 *
 * SAFETY
 * ------
 * This harness is designed to be incapable of touching production:
 *
 *   1. It reads a SEPARATE set of env vars (TEST_SUPABASE_*). It deliberately
 *      does NOT fall back to NEXT_PUBLIC_SUPABASE_* / SUPABASE_SERVICE_ROLE_KEY,
 *      so a normal `.env.local` can never point it at the live project.
 *   2. It refuses to run against any host on the PROD_DENYLIST below.
 *   3. It refuses any host that is not local unless
 *      TEST_ALLOW_REMOTE=yes-i-know is set explicitly.
 *   4. When the env vars are absent it SKIPS cleanly (exit 0) so `npm test`
 *      stays green without a database.
 *
 * SETUP (local Supabase)
 * ----------------------
 *   supabase init && supabase start
 *   # load the schema (see db/README.md — the repo cannot reproduce it from
 *   # its own SQL files, so the schema is dumped from the live project)
 *   TEST_SUPABASE_URL=http://127.0.0.1:54321 \
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=<local service_role from `supabase status`> \
 *   TEST_SUPABASE_ANON_KEY=<local anon from `supabase status`> \
 *   npm run test:db
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Project refs that must never be used as a test target. */
const PROD_DENYLIST = ["dqlsdocmjudzyzmqisrx"];

export interface TestEnv {
  url: string;
  serviceKey: string;
  anonKey: string;
}

/**
 * Resolve test credentials, or return null when none are configured.
 * Throws — loudly — if the configuration points somewhere dangerous.
 */
export function resolveTestEnv(): TestEnv | null {
  const url = process.env.TEST_SUPABASE_URL;
  const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.TEST_SUPABASE_ANON_KEY;

  if (!url || !serviceKey || !anonKey) return null;

  for (const ref of PROD_DENYLIST) {
    if (url.includes(ref)) {
      throw new Error(
        `REFUSING TO RUN: TEST_SUPABASE_URL points at a known production project (${ref}). ` +
          `These tests create and delete rows. Point them at a local or throwaway project.`
      );
    }
  }

  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/.test(url);
  if (!isLocal && process.env.TEST_ALLOW_REMOTE !== "yes-i-know") {
    throw new Error(
      `REFUSING TO RUN: TEST_SUPABASE_URL (${url}) is not localhost. These tests ` +
        `create and delete rows. Set TEST_ALLOW_REMOTE=yes-i-know only for a ` +
        `disposable project you are willing to have mutated.`
    );
  }

  return { url, serviceKey, anonKey };
}

/**
 * Standard entry point for a db-backed suite. Returns null when no test
 * database is configured, after printing a clear skip notice — the caller
 * should then return without failing, so `npm test` stays green.
 */
export function requireTestDb(suiteName: string): TestEnv | null {
  let env: TestEnv | null;
  try {
    env = resolveTestEnv();
  } catch (e) {
    console.error(`\n${(e as Error).message}\n`);
    process.exit(1);
  }

  if (!env) {
    console.log(
      `SKIPPED: ${suiteName} — no test database configured.\n` +
        `         Set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY /\n` +
        `         TEST_SUPABASE_ANON_KEY to run it. See src/lib/tests/db/README.md.\n` +
        `         NOTE: while skipped, this suite proves nothing.`
    );
    return null;
  }
  return env;
}

/** Service-role client. Bypasses RLS — use only for fixture setup/teardown. */
export function adminClient(env: TestEnv): SupabaseClient {
  return createClient(env.url, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Anonymous client — the `anon` role, signed out. */
export function anonClient(env: TestEnv): SupabaseClient {
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Create a confirmed auth user and return a client authenticated AS THAT USER.
 * This is the important part: the returned client carries the user's own JWT,
 * so every query runs under their real `authenticated` role and RLS applies
 * exactly as it would in the browser.
 */
export async function createPersona(
  env: TestEnv,
  admin: SupabaseClient,
  email: string,
  password = "TestPassw0rd!x"
): Promise<{ userId: string; client: SupabaseClient }> {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    throw new Error(`could not create persona ${email}: ${createErr?.message}`);
  }

  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) {
    throw new Error(`could not sign in persona ${email}: ${signInErr.message}`);
  }

  return { userId: created.user.id, client };
}

/* ------------------------------------------------------------------ */
/* Assertions                                                          */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const failures: string[] = [];

export function ok(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.error(`  FAIL  ${label}`);
  }
}

/**
 * Assert a read returned NOTHING. Under RLS a denied SELECT usually comes back
 * as an empty set rather than an error, so "no rows" IS the denial signal.
 */
export function expectNoRows(
  result: { data: unknown[] | null; error: { message: string } | null },
  label: string
): void {
  const n = result.data?.length ?? 0;
  ok(n === 0, `${label} (expected 0 rows, got ${n}${result.error ? `, error: ${result.error.message}` : ""})`);
}

/** Assert a read returned at least one row. */
export function expectRows(
  result: { data: unknown[] | null; error: { message: string } | null },
  label: string
): void {
  const n = result.data?.length ?? 0;
  ok(n > 0, `${label} (expected >0 rows, got ${n}${result.error ? `, error: ${result.error.message}` : ""})`);
}

/** Assert a write/RPC was refused — either an error, or `ok:false`. */
export function expectDenied(
  result: { data?: unknown; error: { message: string } | null },
  label: string
): void {
  ok(result.error !== null, `${label} (expected denial, got ${result.error ? "denied" : "SUCCESS — authorization hole"})`);
}

/**
 * Assert a write was blocked by RLS. Use this instead of expectDenied() for
 * UPDATE (and DELETE) calls made with `.select()`.
 *
 * Under Postgres RLS, a write whose USING clause excludes every matching row
 * does NOT raise an error — it silently affects zero rows. PostgREST then
 * returns `{ data: [], error: null }`. That empty-array response IS the
 * correct denial signal for an UPDATE/DELETE; checking `error !== null` alone
 * (as expectDenied does) produces a false "authorization hole" here, because
 * a correctly-blocked update looks identical, over the wire, to one that
 * matched zero rows for an unrelated reason.
 *
 * This still only proves the CLIENT saw no rows change. Call sites that need
 * to rule out a write that mutated rows without returning them (a `.select()`
 * omitted, or a trigger side effect) should additionally verify the row's
 * actual state with a service-role read, as this suite's investigation of two
 * initial false failures did.
 */
export function expectUpdateBlocked(
  result: { data: unknown[] | null; error: { message: string } | null },
  label: string
): void {
  const blocked = result.error !== null || (Array.isArray(result.data) && result.data.length === 0);
  const rowCount = Array.isArray(result.data) ? result.data.length : "n/a";
  ok(
    blocked,
    `${label} (expected 0 rows updated or an error; got rowCount=${rowCount}${result.error ? `, error: ${result.error.message}` : ""})`
  );
}

/** Assert a write/RPC succeeded. */
export function expectAllowed(
  result: { data?: unknown; error: { message: string } | null },
  label: string
): void {
  ok(result.error === null, `${label}${result.error ? ` (unexpected error: ${result.error.message})` : ""}`);
}

export function summary(suiteName: string): void {
  console.log(`\n${suiteName}: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(`\nFailures:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
}
