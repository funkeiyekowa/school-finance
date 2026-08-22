import { NextResponse } from "next/server";
import { createServiceClient, extractSecret, verifyEmailSecret } from "@/lib/alerts/service";

/**
 * Config feed for the Gmail Apps Script.
 *
 * The script holds only the app URL and the shared secret; every search
 * rule (which label to read, which senders and subjects to accept, batch
 * size) is fetched from here on each run. That means changing the rules is
 * a form edit in Setup rather than a code edit in Apps Script.
 */
export async function GET(request: Request) {
  const supabase = createServiceClient();
  const check = await verifyEmailSecret(supabase, extractSecret(request));

  if (!check.ok) {
    return NextResponse.json({ error: check.message }, { status: check.status });
  }

  const s = check.settings!;

  const splitList = (value: unknown): string[] =>
    String(value ?? "")
      .split(",")
      .map(v => v.trim())
      .filter(Boolean);

  // Record that the script checked in, so Setup can show whether the
  // trigger is actually running.
  await supabase
    .from("school_settings")
    .update({ email_last_sync_at: new Date().toISOString() })
    .eq("id", s.id as string);

  return NextResponse.json({
    enabled: s.email_alerts_enabled === true,
    gmailLabel: (s.email_gmail_label as string) || "BankAlerts",
    processedLabel: (s.email_processed_label as string) || "BankAlerts/Processed",
    allowedSenders: splitList(s.email_allowed_senders),
    subjectKeywords: splitList(s.email_subject_keywords),
    maxPerRun: Number(s.email_max_per_run) || 25,
    webhookUrl: new URL("/api/email-webhook", request.url).toString(),
  });
}
