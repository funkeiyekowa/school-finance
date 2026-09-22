import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");
const askRoute = fs.readFileSync(path.join(root, "app", "api", "ai", "ask", "route.ts"), "utf8");
const aiServer = fs.readFileSync(path.join(root, "ai", "server.ts"), "utf8");
const aiConfig = fs.readFileSync(path.join(root, "..", "supabase", "ai_assistant_module.sql"), "utf8");

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
assert.match(aiServer, /userId: userId/);
assert.match(aiServer, /ai_generation_log/);
assert.match(aiConfig, /set_org_assistant_config/);
assert.match(aiConfig, /_is_org_admin_for/);

console.log("AI governance scope, exam-lock, audit, and admin-control contracts passed.");
