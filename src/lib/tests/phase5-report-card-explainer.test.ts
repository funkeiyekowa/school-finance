import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), "utf8");

const route = read("src", "app", "api", "ai", "report-card-explainer", "route.ts");
const access = read("src", "lib", "ai", "reportCardAccess.ts");
const panel = read("src", "components", "ai", "ReportCardExplainer.tsx");
const detailPage = read("src", "app", "dashboard", "report-cards", "[id]", "page.tsx");
const rateLimit = read("src", "lib", "api", "rateLimit.ts");
const prompts = read("src", "lib", "ai", "prompts.ts");

// --- Route: authenticated, role-checked, rate-limited, reuses the shared
//     provider/audit path (never calls the provider directly). ---
assert.match(route, /requireActiveSession/);
assert.match(route, /getAuthorizedReportCard/);
assert.match(route, /runAiCompletion/);
assert.match(route, /rateLimitAsync/);
assert.match(route, /ai_generated: true/);
assert.match(route, /review_required: true/);
assert.doesNotMatch(route, /fetch\(provider\.config\.baseUrl/);

// Role gate: must reject anything other than student/parent explicitly.
assert.match(route, /session\.role !== "student" && session\.role !== "parent"/);

// --- Access helper: org-scoped, published-only, ownership re-verified
//     independently of RLS (fail closed), using the canonical parent link
//     chain (not an unverified nested-embed query). ---
for (const required of [
  '.eq("organization_id", session.organizationId)',
  '.eq("published", true)',
  '.eq("profile_id", session.user.id)',
  '.from("parent_profiles")',
  '.from("parent_student_links")',
  '.eq("parent_id", parentId)',
]) {
  assert.match(access, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing check: ${required}`);
}
assert.doesNotMatch(access, /!inner\(/, "should not rely on an unverified nested-embed filter for an authorization check");
assert.match(access, /Do NOT invent, estimate, or guess/);
assert.match(access, /NOT an official school record/);

// --- Preset reuse: no new AI preset was introduced; the already-wired
//     student_term_summary preset is reused. ---
assert.match(route, /kind: "student_term_summary"/);
assert.match(prompts, /student_term_summary/);

// --- Rate limiter: new bucket name registered, not an ad hoc string. ---
assert.match(rateLimit, /"report-card-explainer"/);
assert.match(route, /name: "report-card-explainer"/);

// --- Panel: labelled as AI-generated, never silently overwrites a
//     school record (no write call to report_cards from the panel). ---
assert.match(panel, /AI-generated/);
assert.match(panel, /explainReportCard/);
assert.doesNotMatch(panel, /\.from\("report_cards"\)/);
assert.doesNotMatch(panel, /\.update\(/);

// --- Wiring: only rendered for the family (student/parent) viewer, and
//     only for a published card -- never shown to staff editing the draft,
//     and never for a card the family couldn't otherwise see via RLS. ---
assert.match(detailPage, /ReportCardExplainer/);
assert.match(detailPage, /isFamilyViewer && rc\.published/);
assert.match(detailPage, /membership\?\.role === "student" \|\| membership\?\.role === "parent"/);

console.log("Phase 5 report-card explainer contract checks passed.");
console.log("Live Supabase (published card, linked parent, and student-self) verification remains required.");
