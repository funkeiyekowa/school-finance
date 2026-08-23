"use client";

/**
 * Tenant isolation verification.
 *
 * Two independent checks:
 *   1. Static posture — introspects the database (RLS flags, policy bodies,
 *      NULL tenant columns, per-org unique indexes) via verify_tenant_isolation().
 *   2. Behavioural proof — POSTs to /api/platform/verify-isolation, which
 *      provisions two throwaway schools and actually attempts cross-tenant
 *      reads and writes with real sessions.
 *
 * A green static check with a red behavioural check means the schema looks
 * right but something in the policy logic is wrong. That distinction is the
 * point of running both.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import {
  ShieldCheck, ShieldAlert, RefreshCw, PlayCircle, CheckCircle2, XCircle,
  AlertTriangle, Database, Lock, KeyRound, Info, ChevronDown, ChevronRight,
} from "lucide-react";

interface TableReport {
  table: string;
  exists: boolean;
  rls_enabled?: boolean;
  policy_count?: number;
  tenant_scoped_policies?: number;
  org_id_not_null?: boolean;
  null_org_rows?: number;
  pass?: boolean;
}

interface StaticReport {
  generated_at: string;
  helper_functions: Record<string, boolean>;
  tables: TableReport[];
  null_org_tables: { table: string; count: number }[];
  open_policies: { table: string; policy: string; command: string }[];
  unique_indexes: { table: string; index: string; includes_org: boolean; definition: string }[];
  organization_count: number;
  membership_count: number;
  users_without_org: number;
  all_pass: boolean;
}

interface TestResult {
  id: string;
  name: string;
  expectation: string;
  status: "pass" | "fail" | "skip" | "error";
  detail?: string;
  severity: "critical" | "high" | "medium";
}

interface SuiteReport {
  ran: boolean;
  reason?: string;
  durationMs?: number;
  results: TestResult[];
  summary: {
    total: number; passed: number; failed: number; skipped: number;
    errored: number; criticalFailures: number; allPass: boolean;
  };
  cleanup: { ok: boolean; detail?: string };
}

export default function VerifyIsolationPage() {
  const { isSuperAdmin } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [staticReport, setStaticReport] = useState<StaticReport | null>(null);
  const [staticError, setStaticError] = useState<string | null>(null);
  const [loadingStatic, setLoadingStatic] = useState(true);

  const [suite, setSuite] = useState<SuiteReport | null>(null);
  const [suiteError, setSuiteError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const [showRaw, setShowRaw] = useState(false);

  const loadStatic = useCallback(async () => {
    setLoadingStatic(true);
    setStaticError(null);
    const { data, error } = await supabase.rpc("verify_tenant_isolation");
    if (error) {
      setStaticError(
        error.message.includes("does not exist")
          ? "verify_tenant_isolation() is missing. Run supabase/saas_foundation.sql in the Supabase SQL editor, then reload."
          : error.message
      );
      setStaticReport(null);
    } else {
      setStaticReport(data as StaticReport);
    }
    setLoadingStatic(false);
  }, [supabase]);

  useEffect(() => { if (isSuperAdmin) loadStatic(); }, [isSuperAdmin, loadStatic]);

  async function runSuite() {
    setRunning(true);
    setSuiteError(null);
    setSuite(null);
    try {
      const res = await fetch("/api/platform/verify-isolation", { method: "POST" });
      const body = await res.json();
      if (body.ran === false) {
        setSuiteError(body.reason ?? "The suite did not run.");
        setSuite(null);
      } else {
        setSuite(body as SuiteReport);
      }
    } catch (e) {
      setSuiteError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setRunning(false);
    }
  }

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto text-center py-16">
          <ShieldAlert size={40} className="mx-auto text-gray-300 mb-3" />
          <h2 className="font-bold text-gray-900 mb-1">Platform admin access required</h2>
          <p className="text-sm text-gray-500">
            Isolation verification touches every tenant, so it is restricted to platform
            administrators.
          </p>
        </div>
      </div>
    );
  }

  const tables = staticReport?.tables ?? [];
  const presentTables = tables.filter(t => t.exists);
  const failingTables = presentTables.filter(t => !t.pass);

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Tenant Isolation Verification"
        subtitle="Prove that one school cannot reach another school's data"
      >
        <Button size="sm" variant="secondary" onClick={loadStatic} loading={loadingStatic}>
          <RefreshCw size={14} /> Re-check schema
        </Button>
        <Button size="sm" variant="gold" onClick={runSuite} loading={running}>
          <PlayCircle size={14} /> Run isolation suite
        </Button>
      </PageHeader>

      {/* ---------- Overall verdict ---------- */}
      <VerdictBanner
        staticPass={staticReport?.all_pass ?? null}
        suite={suite}
        staticError={staticError}
      />

      {/* ---------- 1. Static posture ---------- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Database size={15} /> Schema posture
            </CardTitle>
            {staticReport && (
              <span className="text-xs text-gray-400">
                checked {new Date(staticReport.generated_at).toLocaleTimeString()}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadingStatic && <LoadingSpinner />}

          {staticError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
              <AlertTriangle size={15} className="mt-px shrink-0" />
              <span>{staticError}</span>
            </div>
          )}

          {staticReport && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Schools" value={String(staticReport.organization_count)} />
                <Stat label="Memberships" value={String(staticReport.membership_count)} />
                <Stat
                  label="Users with no school"
                  value={String(staticReport.users_without_org)}
                  bad={staticReport.users_without_org > 0}
                  hint={staticReport.users_without_org > 0 ? "They will see an empty app" : undefined}
                />
                <Stat
                  label="Tables failing"
                  value={`${failingTables.length}/${presentTables.length}`}
                  bad={failingTables.length > 0}
                />
              </div>

              {/* Helper functions */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                  <KeyRound size={12} /> Helper functions
                </h4>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(staticReport.helper_functions).map(([fn, present]) => (
                    <span key={fn} className={cn(
                      "inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-mono",
                      present ? "bg-green-50 text-green-800 border border-green-200"
                              : "bg-red-50 text-red-700 border border-red-200"
                    )}>
                      {present ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                      {fn}()
                    </span>
                  ))}
                </div>
              </div>

              {/* Open policies — the dangerous ones */}
              {staticReport.open_policies.length > 0 && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                  <h4 className="text-xs font-bold text-red-800 mb-2 flex items-center gap-1.5">
                    <ShieldAlert size={13} /> Wide-open policies on tenant tables
                  </h4>
                  <p className="text-xs text-red-700 mb-2">
                    These policies have no restriction at all, so they defeat tenant
                    isolation for the table they sit on.
                  </p>
                  <ul className="space-y-1">
                    {staticReport.open_policies.map((p, i) => (
                      <li key={i} className="text-xs font-mono text-red-800">
                        {p.table} · {p.policy} · {p.command}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Per-table detail */}
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-3 py-2 font-semibold text-gray-600">Table</th>
                      <th className="text-center px-3 py-2 font-semibold text-gray-600">RLS on</th>
                      <th className="text-center px-3 py-2 font-semibold text-gray-600">Policies</th>
                      <th className="text-center px-3 py-2 font-semibold text-gray-600">Tenant-scoped</th>
                      <th className="text-center px-3 py-2 font-semibold text-gray-600">org_id NOT NULL</th>
                      <th className="text-center px-3 py-2 font-semibold text-gray-600">Orphan rows</th>
                      <th className="text-center px-3 py-2 font-semibold text-gray-600">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.map(t => (
                      <tr key={t.table} className={cn(
                        "border-b last:border-0",
                        !t.exists ? "opacity-50" : t.pass ? "hover:bg-green-50/40" : "bg-red-50/50"
                      )}>
                        <td className="px-3 py-2 font-mono text-xs">{t.table}</td>
                        {!t.exists ? (
                          <td colSpan={6} className="px-3 py-2 text-xs text-gray-400 text-center">
                            not installed
                          </td>
                        ) : (
                          <>
                            <td className="px-3 py-2 text-center"><Tick ok={!!t.rls_enabled} /></td>
                            <td className="px-3 py-2 text-center text-xs text-gray-600">{t.policy_count ?? 0}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={cn(
                                "text-xs font-semibold",
                                (t.tenant_scoped_policies ?? 0) > 0 ? "text-green-700" : "text-red-600"
                              )}>
                                {t.tenant_scoped_policies ?? 0}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center"><Tick ok={!!t.org_id_not_null} /></td>
                            <td className="px-3 py-2 text-center">
                              <span className={cn(
                                "text-xs font-semibold",
                                (t.null_org_rows ?? 0) === 0 ? "text-gray-500" : "text-red-600"
                              )}>
                                {t.null_org_rows ?? 0}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              {t.pass
                                ? <Badge variant="green">pass</Badge>
                                : <Badge variant="red">fail</Badge>}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Unique indexes */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                  <Lock size={12} /> Unique constraints on shared identifiers
                </h4>
                <p className="text-xs text-gray-500 mb-2">
                  A unique index that omits organization_id stops a second school from
                  reusing a code the first school already used.
                </p>
                <div className="space-y-1">
                  {staticReport.unique_indexes.map((ix, i) => (
                    <div key={i} className={cn(
                      "flex items-start gap-2 p-2 rounded text-xs",
                      ix.includes_org ? "bg-green-50" : "bg-amber-50"
                    )}>
                      {ix.includes_org
                        ? <CheckCircle2 size={12} className="text-green-600 mt-0.5 shrink-0" />
                        : <AlertTriangle size={12} className="text-amber-600 mt-0.5 shrink-0" />}
                      <div className="min-w-0">
                        <span className="font-mono font-semibold">{ix.table}</span>
                        <span className="text-gray-400"> · </span>
                        <span className="font-mono">{ix.index}</span>
                        {!ix.includes_org && (
                          <span className="ml-1 text-amber-700 font-semibold">
                            (global — may collide across schools)
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setShowRaw(v => !v)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
              >
                {showRaw ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Raw report
              </button>
              {showRaw && (
                <pre className="text-[10px] bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto max-h-72">
                  {JSON.stringify(staticReport, null, 2)}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- 2. Behavioural suite ---------- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck size={15} /> Cross-tenant attack suite
            </CardTitle>
            {suite?.durationMs != null && (
              <span className="text-xs text-gray-400">{suite.durationMs} ms</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 mb-4">
            <Info size={14} className="mt-px shrink-0" />
            <div>
              This provisions two temporary schools with their own users, signs in as
              each, and then genuinely tries to read, update, delete, and insert across
              the tenant boundary. Fixtures are removed afterwards. Your real data is
              never read or modified.
            </div>
          </div>

          {suiteError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 mb-4">
              <AlertTriangle size={15} className="mt-px shrink-0" />
              <span>{suiteError}</span>
            </div>
          )}

          {running && (
            <div className="py-8 text-center">
              <LoadingSpinner />
              <p className="text-xs text-gray-500">
                Provisioning schools, signing in, attempting breaches…
              </p>
            </div>
          )}

          {!running && !suite && !suiteError && (
            <div className="py-10 text-center">
              <ShieldCheck size={32} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">
                Not run yet. Press <strong>Run isolation suite</strong> to execute it.
              </p>
            </div>
          )}

          {suite && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Passed" value={String(suite.summary.passed)} good />
                <Stat label="Failed" value={String(suite.summary.failed)} bad={suite.summary.failed > 0} />
                <Stat label="Errored" value={String(suite.summary.errored)} bad={suite.summary.errored > 0} />
                <Stat
                  label="Critical breaches"
                  value={String(suite.summary.criticalFailures)}
                  bad={suite.summary.criticalFailures > 0}
                />
              </div>

              {!suite.cleanup.ok && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  <AlertTriangle size={14} className="mt-px shrink-0" />
                  <span>
                    Cleanup did not finish: {suite.cleanup.detail}. Look for
                    organizations with an <code>isotest-</code> slug and remove them.
                  </span>
                </div>
              )}

              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {suite.results.map(r => (
                  <div key={r.id} className={cn(
                    "flex items-start gap-3 p-3",
                    r.status === "fail" || r.status === "error" ? "bg-red-50" : ""
                  )}>
                    <span className="shrink-0 mt-0.5">
                      {r.status === "pass" && <CheckCircle2 size={15} className="text-green-600" />}
                      {r.status === "fail" && <XCircle size={15} className="text-red-600" />}
                      {r.status === "error" && <AlertTriangle size={15} className="text-red-600" />}
                      {r.status === "skip" && <Info size={15} className="text-gray-400" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-gray-400">{r.id}</span>
                        <span className="text-sm font-medium text-gray-900">{r.name}</span>
                        {r.severity === "critical" && (
                          <span className="text-[9px] font-bold uppercase text-red-700 bg-red-100 px-1 rounded">
                            critical
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">Expected: {r.expectation}</p>
                      {r.detail && (
                        <p className={cn(
                          "text-xs mt-1",
                          r.status === "pass" ? "text-gray-400" : "text-red-700 font-medium"
                        )}>
                          {r.detail}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>How to verify by hand</CardTitle></CardHeader>
        <CardContent>
          <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
            <li>Run <code className="text-xs bg-gray-100 px-1 rounded">supabase/saas_foundation.sql</code> in the Supabase SQL editor.</li>
            <li>In <strong>Platform Admin → Schools</strong>, provision a second school.</li>
            <li>Have a second person sign up, or create an account for them in Supabase Auth.</li>
            <li>In <strong>Platform Admin → Members</strong>, pick the new school and add that account as Admin with &ldquo;landing school&rdquo; ticked.</li>
            <li>Sign in as that user in a separate browser profile. The sidebar should name the new school, and the student, income, and expense lists should all be empty.</li>
            <li>Add a student there, then switch back to the first account. That student must not appear.</li>
            <li>Turn a module off for one school in <strong>Platform Admin</strong> and navigate straight to its URL. It should be blocked, not merely hidden.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function VerdictBanner({
  staticPass, suite, staticError,
}: {
  staticPass: boolean | null;
  suite: SuiteReport | null;
  staticError: string | null;
}) {
  const suitePass = suite?.summary.allPass ?? null;

  let tone: "good" | "bad" | "unknown" = "unknown";
  let title = "Not yet verified";
  let body = "Run both checks to get a verdict.";

  if (staticError) {
    tone = "unknown";
    title = "Migration not applied";
    body = "The verification functions are missing, so nothing can be checked yet.";
  } else if (staticPass === false || suitePass === false) {
    tone = "bad";
    title = "Isolation is NOT verified";
    body = suitePass === false
      ? "The attack suite got through, or a check errored. Details below."
      : "The schema check found gaps. Details below.";
  } else if (staticPass && suitePass) {
    tone = "good";
    title = "Tenant isolation verified";
    body = "The schema is correctly scoped and live cross-tenant attempts were all refused.";
  } else if (staticPass && suitePass === null) {
    tone = "unknown";
    title = "Schema looks correct";
    body = "Run the attack suite to confirm the policies behave as the schema suggests.";
  }

  const styles = {
    good: "bg-green-50 border-green-300 text-green-900",
    bad: "bg-red-50 border-red-300 text-red-900",
    unknown: "bg-gray-50 border-gray-300 text-gray-800",
  }[tone];

  return (
    <div className={cn("flex items-start gap-3 p-4 rounded-xl border-2", styles)} role="status">
      {tone === "good" && <ShieldCheck size={22} className="shrink-0 mt-0.5" />}
      {tone === "bad" && <ShieldAlert size={22} className="shrink-0 mt-0.5" />}
      {tone === "unknown" && <Info size={22} className="shrink-0 mt-0.5" />}
      <div>
        <div className="font-bold">{title}</div>
        <p className="text-sm mt-0.5">{body}</p>
      </div>
    </div>
  );
}

function Stat({
  label, value, good, bad, hint,
}: {
  label: string; value: string; good?: boolean; bad?: boolean; hint?: string;
}) {
  return (
    <div className={cn(
      "rounded-lg border p-3",
      bad ? "bg-red-50 border-red-200" : good ? "bg-green-50 border-green-200" : "bg-white border-gray-200"
    )}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</div>
      <div className={cn(
        "text-xl font-bold mt-0.5",
        bad ? "text-red-700" : good ? "text-green-700" : "text-[#0F2A47]"
      )}>{value}</div>
      {hint && <div className="text-[10px] text-gray-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function Tick({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 size={14} className="text-green-600 inline" aria-label="yes" />
    : <XCircle size={14} className="text-red-600 inline" aria-label="no" />;
}
