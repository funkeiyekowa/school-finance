import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseAiJsonObject } from "../ai/json.js";
import { redactLessonContent } from "../ai/studentLesson.js";

const root = path.resolve(__dirname, "..", "..", "..");
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), "utf8");

const helper = read("src", "app", "api", "ai", "lms-study-help", "route.ts");
const practice = read("src", "app", "api", "ai", "lms-practice", "route.ts");
const context = read("src", "lib", "ai", "studentLesson.ts");
const aiServer = read("src", "lib", "ai", "server.ts");
const lessonPage = read("src", "app", "dashboard", "my-courses", "[courseId]", "lessons", "[lessonId]", "page.tsx");

assert.match(helper, /requireActiveSession/);
assert.match(helper, /getAuthorizedStudentLesson/);
assert.match(helper, /runAiCompletion/);
assert.match(helper, /ai_generated: true/);
assert.doesNotMatch(helper, /fetch\(provider\.config\.baseUrl/);
assert.match(practice, /getAuthorizedStudentLesson/);
assert.match(practice, /runAiCompletion/);
assert.match(practice, /lms-practice/);
assert.match(practice, /lms_flashcards/);
assert.match(practice, /review_required: true/);
assert.doesNotMatch(practice, /fetch\(provider\.config\.baseUrl/);

for (const required of [
  '.eq("profile_id", session.user.id)',
  '.eq("organization_id", session.organizationId)',
  '.eq("status", "published")',
  '.eq("status", "active")',
  '.eq("status", "in_progress")',
]) assert.match(context, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing authorization check: ${required}`);

assert.match(context, /active exam/i);
assert.match(context, /redactLessonContent/);
assert.match(aiServer, /ai_generation_log/);
assert.match(lessonPage, /\/api\/ai\/lms-study-help/);
assert.match(lessonPage, /\/api\/ai\/lms-practice/);
assert.match(lessonPage, /review before relying on it/);

assert.equal(parseAiJsonObject<{ value: number }>("```json\n{\"value\": 2}\n```")?.value, 2);
assert.equal(parseAiJsonObject("not json"), null);
assert.match(redactLessonContent("Email test@example.com or call +234 801 234 5678"), /email removed/);
assert.doesNotMatch(redactLessonContent("Email test@example.com or call +234 801 234 5678"), /test@example\.com/);
assert.doesNotMatch(redactLessonContent("Email test@example.com or call +234 801 234 5678"), /801 234 5678/);

console.log("Phase 3 AI foundation contract checks passed.");
console.log("Live provider, Supabase tenant, role, and active-exam checks remain required.");
