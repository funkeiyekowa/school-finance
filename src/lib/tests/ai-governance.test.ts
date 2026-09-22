import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const askRoute = fs.readFileSync(path.join(root, "src", "app", "api", "ai", "ask", "route.ts"), "utf8");
const generateRoute = fs.readFileSync(path.join(root, "src", "app", "api", "ai", "generate", "route.ts"), "utf8");
const aiServer = fs.readFileSync(path.join(root, "src", "lib", "ai", "server.ts"), "utf8");
const prompts = fs.readFileSync(path.join(root, "src", "lib", "ai", "prompts.ts"), "utf8");
const aiConfig = fs.readFileSync(path.join(root, "supabase", "ai_assistant_module.sql"), "utf8");

assert.match(askRoute, /requireActiveSession/);
assert.match(askRoute, /session\.organizationId/);
assert.match(askRoute, /session\.user\.id/);
assert.match(askRoute, /has_active_exam_attempt/);
assert.match(askRoute, /get_org_assistant_config/);
assert.match(askRoute, /allowed_roles/);
assert.match(askRoute, /student_safe_mode/);
assert.match(askRoute, /systemOverride/);
assert.doesNotMatch(askRoute, /body\.systemPrompt|body\.systemOverride/);
assert.match(askRoute, /rateLimitAsync/);

assert.match(aiServer, /organizationId: orgId/);
assert.match(aiServer, /user_id: userId/);
assert.match(aiServer, /ai_generation_log/);

// High-stakes AI must remain a teacher-reviewed draft, not an authoritative grade.
assert.match(prompts, /lms_grading_assist/);
assert.match(prompts, /human teacher reviews/);
assert.match(prompts, /message_polish/);
assert.match(prompts, /message_announcement_draft/);
assert.match(generateRoute, /output/);
assert.doesNotMatch(generateRoute, /sendMessage|publishAnnouncement|saveGrade|finalizeGrade/);
assert.doesNotMatch(askRoute, /sendMessage|publishAnnouncement|saveGrade|finalizeGrade/);

// Red-team contracts: user text stays in the user turn, while safety and
// answer-key protections remain fixed in server-controlled system prompts.
assert.match(prompts, /learning_assistant[\s\S]*Never produce disallowed, unsafe, adult, violent or hateful content/);
assert.match(prompts, /lms_quiz_generate[\s\S]*Base every question strictly on the given lesson content/);
assert.match(prompts, /lms_quiz_generate[\s\S]*Exactly one option per question must have is_correct true/);
assert.match(prompts, /attendance_insights[\s\S]*anonymised attendance statistics/);
assert.match(prompts, /attendance_insights[\s\S]*Do not reference any student by name/);
assert.match(prompts, /attendance_insights[\s\S]*Do not make disciplinary recommendations/);
assert.match(generateRoute, /preset\.system/);
assert.doesNotMatch(generateRoute, /systemOverride/);

assert.match(aiConfig, /set_org_assistant_config/);
assert.match(aiConfig, /_is_org_admin_for/);

console.log("AI governance scope, exam-lock, audit, draft-only, prompt-injection, and answer-key contracts passed.");
