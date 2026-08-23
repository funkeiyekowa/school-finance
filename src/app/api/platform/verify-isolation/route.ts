import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { runIsolationSuite, type SuiteReport } from "@/lib/platform/isolation-suite";

/**
 * Runs the tenant-isolation suite against the live database.
 *
 * Guarded twice over:
 *   1. The caller must have a session AND satisfy is_platform_admin().
 *   2. SUPABASE_SERVICE_ROLE_KEY must be configured explicitly. The shared
 *      createServiceClient() helper falls back to the anon key when it is
 *      absent, which would make the suite silently meaningless — so this
 *      route reads the variable directly and refuses without it.
 *
 * The suite writes fixture data. It never touches existing records: every
 * row it creates belongs to two throwaway organizations that are deleted
 * afterwards.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const supabase = await createServerSupabase();

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json(
      { ran: false, reason: "Not signed in." },
      { status: 401 }
    );
  }

  // Authorization is decided by the database, not by client-supplied claims.
  const { data: isAdmin, error: adminErr } = await supabase.rpc("is_platform_admin");
  if (adminErr) {
    return NextResponse.json(
      {
        ran: false,
        reason:
          "Could not check platform admin status. Run supabase/saas_foundation.sql, " +
          `then retry. (${adminErr.message})`,
      },
      { status: 500 }
    );
  }
  if (isAdmin !== true) {
    return NextResponse.json(
      { ran: false, reason: "Platform admin access required." },
      { status: 403 }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      { ran: false, reason: "Supabase URL or anon key is not configured." },
      { status: 500 }
    );
  }

  if (!serviceKey) {
    const report: SuiteReport = {
      ran: false,
      reason:
        "SUPABASE_SERVICE_ROLE_KEY is not set. The suite needs it to create the two " +
        "throwaway schools and their users. Add it to .env.local (and to your hosting " +
        "environment) from Supabase → Project Settings → API → service_role. Keep it " +
        "server-side only; never expose it with a NEXT_PUBLIC_ prefix.",
      startedAt: new Date().toISOString(),
      results: [],
      summary: {
        total: 0, passed: 0, failed: 0, skipped: 0, errored: 0,
        criticalFailures: 0, allPass: false,
      },
      cleanup: { ok: true },
    };
    return NextResponse.json(report, { status: 428 });
  }

  if (serviceKey === anonKey) {
    return NextResponse.json(
      {
        ran: false,
        reason:
          "SUPABASE_SERVICE_ROLE_KEY is identical to the anon key. The suite would run " +
          "without the privileges it needs and report false passes. Use the real " +
          "service_role key.",
      },
      { status: 428 }
    );
  }

  try {
    const report = await runIsolationSuite({
      supabaseUrl: url,
      serviceRoleKey: serviceKey,
      anonKey,
    });

    // Leave an audit trail: this endpoint writes to the live database.
    await supabase.from("activity_log").insert({
      user_email: user.email,
      action: "Run Tenant Isolation Suite",
      details: `${report.summary.passed}/${report.summary.total} passed` +
               (report.summary.criticalFailures > 0
                 ? `, ${report.summary.criticalFailures} critical failure(s)`
                 : ""),
    });

    return NextResponse.json(report, {
      status: report.summary.allPass ? 200 : 409,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ran: false,
        reason: e instanceof Error ? e.message : "The suite crashed unexpectedly.",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    {
      ran: false,
      reason: "Use POST to run the suite. It creates and deletes fixture data.",
    },
    { status: 405 }
  );
}
