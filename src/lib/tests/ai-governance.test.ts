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
assert.match(askRoute, /session\\.organizationId/);
assert.match(askRoute, /session\\.user\\.id/);
assert.match(askRoute, /has_active_exam_attempt/);
assert.match(askRoute, /get_org_assistant_config/);
assert.match(askRoute, /allowed_roles/);
assert.match(askRoute, /student_safe_mode/);
assert.match(askRoute, /systemOverride/);
assert.doesNotMatch(askRoute, /body\\.systemPrompt|body\\.systemOverride/);
assert.match(askRoute, /rateLimitAsync/);

assert.match(aiServer, /organizationId: orgId/);
assert.match(aiServer, /user_id: userId/);
assert.match(aiServer, /ai_generation_log/);

// High-stakes AI must remain a teacher-reviewed draft, not an authoritative grade.
assert.match(prompts, /lms_grading_assist[\\s\\S]*human teacher reviews/);
assert.match(prompts, /message_polish[\\s\\S]*Return only the rewritten message/);
assert.match(prompts, /message_announcement_draft[\\s\\S]*drafting a school announcement/);
assert.match(generateRoute, /output/);
assert.doesNotMatch(generateRoute, /sendMessage|publishAnnouncement|saveGrade|finalizeGrade/);
assert.doesNotMatch(askRoute, /sendMessage|publishAnnouncement|saveGrade|finalizeGrade/);

assert.match(aiConfig, /set_org_assistant_config/);
assert.match(aiConfig, /_is_org_admin_for/);

console.log("AI governance scope, exam-lock, audit, admin-control, and draft-only contracts passed.");
