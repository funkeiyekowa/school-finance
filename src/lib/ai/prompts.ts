/**
 * Prompt templates and preset library for the in-app AI helpers.
 *
 * Kept out of the UI layer so the same shapes can be reused by:
 *   • The AI dashboard module (/dashboard/ai)
 *   • The report-card comment "Ask AI" affordance
 *   • The announcement composer
 *   • Future Website Studio copy helpers
 *
 * Every preset is deliberately concrete about persona and length so
 * the model does not drift into corporate-jargon prose.
 */

export type AiTaskKind =
  | "polish"
  | "shorten"
  | "expand"
  | "rewrite_positive"
  | "rewrite_encouraging"
  | "translate_formal"
  | "principal_comment"
  | "class_teacher_comment"
  | "announcement_draft"
  | "sms_reminder"
  | "website_tagline"
  | "website_paragraph"
  | "seo_description"
  | "free_form"
  | "assistant_help"
  | "connection_test"
  | "lms_lesson_generate"
  | "lms_quiz_generate"
  | "lms_grading_assist"
  | "lms_course_outline"
  | "lms_bulk_parse"
  | "student_term_summary"
  | "analytics_digest"
  | "student_brief"
  | "expense_category_suggest"
  | "school_newsletter"
  | "message_polish"
  | "message_shorten"
  | "message_translate"
  | "message_announcement_draft"
  | "message_thread_summary";

export interface AiPreset {
  kind: AiTaskKind;
  label: string;
  description: string;
  /** System prompt that primes the model. */
  system: string;
  /** Function that builds the user turn from raw input. */
  compose: (input: string, extra?: Record<string, string>) => string;
  /** Soft cap for the response — passed to max_tokens where applicable. */
  maxTokens?: number;
}

const CORE_STYLE =
  "You are drafting for a Nigerian K-12 school. Use plain, warm British English (schools, not 'grade schools'). No emoji unless the caller adds them. No filler like 'certainly!' or 'as an AI'. Keep names, dates and numbers exactly as given.";

export const AI_PRESETS: Record<AiTaskKind, AiPreset> = {
  polish: {
    kind: "polish",
    label: "Polish tone",
    description: "Smooth grammar and phrasing without changing meaning or length.",
    system: `${CORE_STYLE} Polish the text: fix grammar, tighten phrasing, keep the meaning and roughly the same length. Return the polished text only.`,
    compose: (input) => input,
  },
  shorten: {
    kind: "shorten",
    label: "Make it shorter",
    description: "Reduce length by ~40% while keeping the core message.",
    system: `${CORE_STYLE} Rewrite the text to be about 40% shorter, keeping the key message. Return only the rewritten text.`,
    compose: (input) => input,
  },
  expand: {
    kind: "expand",
    label: "Expand with detail",
    description: "Add one or two natural, non-fluffy sentences of supporting detail.",
    system: `${CORE_STYLE} Expand the text by one or two sentences of concrete, supportive detail. Do not invent facts. Return only the expanded text.`,
    compose: (input) => input,
  },
  rewrite_positive: {
    kind: "rewrite_positive",
    label: "Frame constructively",
    description: "Keep the substance but soften and frame criticism supportively.",
    system: `${CORE_STYLE} Rewrite the comment so it acknowledges effort and frames any critique as growth areas. Do not remove the substance. Return only the rewritten comment.`,
    compose: (input) => input,
  },
  rewrite_encouraging: {
    kind: "rewrite_encouraging",
    label: "Make it encouraging",
    description: "Add warmth suitable for a student- or parent-facing note.",
    system: `${CORE_STYLE} Rewrite so it sounds warm and encouraging, addressed to a student or parent, without hollow praise. Return only the rewritten text.`,
    compose: (input) => input,
  },
  translate_formal: {
    kind: "translate_formal",
    label: "Sharpen formality",
    description: "Adjust to a formal register suitable for school communications.",
    system: `${CORE_STYLE} Rewrite in a formal register suitable for a school communication. Preserve names and numbers exactly. Return only the rewritten text.`,
    compose: (input) => input,
  },
  principal_comment: {
    kind: "principal_comment",
    label: "Principal's comment",
    description: "Two-sentence report-card comment from the principal.",
    system: `${CORE_STYLE} You are a school principal writing an end-of-term comment on a student's report card. Two to three sentences. Reference specific strengths and one area to work on. No greeting or signoff.`,
    compose: (input, extra) => {
      const student = extra?.student_name ?? "the student";
      const avg = extra?.average_score ?? "unknown";
      const rank = extra?.position ?? "unknown";
      const notes = input?.trim() ? `\nTeacher notes: ${input.trim()}` : "";
      return `Student: ${student}\nAverage: ${avg}\nPosition in class: ${rank}${notes}\n\nWrite the principal's comment.`;
    },
    maxTokens: 220,
  },
  class_teacher_comment: {
    kind: "class_teacher_comment",
    label: "Class teacher comment",
    description: "Two-sentence class-teacher comment, warmer than the principal.",
    system: `${CORE_STYLE} You are a class teacher writing an end-of-term comment on a student's report card. Two sentences. Highlight behaviour and effort. No greeting or signoff.`,
    compose: (input, extra) => {
      const student = extra?.student_name ?? "the student";
      const avg = extra?.average_score ?? "unknown";
      const notes = input?.trim() ? `\nTeacher notes: ${input.trim()}` : "";
      return `Student: ${student}\nAverage: ${avg}${notes}\n\nWrite the class teacher's comment.`;
    },
    maxTokens: 220,
  },
  announcement_draft: {
    kind: "announcement_draft",
    label: "Draft an announcement",
    description: "One-paragraph school announcement from a rough brief.",
    system: `${CORE_STYLE} You are drafting an announcement from the school to parents and students. One paragraph. Include the essential facts (what, when, who) if provided. Do NOT invent times, venues, or dates. Return only the announcement body.`,
    compose: (input) => input,
    maxTokens: 320,
  },
  sms_reminder: {
    kind: "sms_reminder",
    label: "SMS reminder (140 chars)",
    description: "Short reminder for SMS delivery, kept under 140 characters.",
    system: `${CORE_STYLE} Write a single SMS to a parent from a school. Maximum 140 characters. No greeting, no signoff, no emoji.`,
    compose: (input) => input,
    maxTokens: 120,
  },
  website_tagline: {
    kind: "website_tagline",
    label: "Website tagline",
    description: "Five to nine word tagline for a school hero section.",
    system: `${CORE_STYLE} Write a short school hero tagline. 5 to 9 words. No punctuation at the end. Return the tagline only.`,
    compose: (input, extra) => {
      const name = extra?.school_name ?? "the school";
      return `School: ${name}\nBrief: ${input}\n\nGive one tagline.`;
    },
    maxTokens: 40,
  },
  website_paragraph: {
    kind: "website_paragraph",
    label: "Website paragraph",
    description: "One to two paragraphs of website body copy from a brief.",
    system: `${CORE_STYLE} Write website body copy. One or two paragraphs, welcoming, honest, no marketing clichés. Return only the copy.`,
    compose: (input, extra) => {
      const name = extra?.school_name ?? "the school";
      const audience = extra?.audience ?? "prospective parents";
      return `School: ${name}\nSection audience: ${audience}\nBrief: ${input}\n\nWrite the copy.`;
    },
    maxTokens: 400,
  },
  seo_description: {
    kind: "seo_description",
    label: "SEO meta description",
    description: "155-character meta description for search engines.",
    system: `${CORE_STYLE} Write an SEO meta description. 130 to 155 characters. Plain, factual, no marketing exclamation. Return the description only.`,
    compose: (input, extra) => {
      const name = extra?.school_name ?? "the school";
      return `School: ${name}\nPage brief: ${input}\n\nWrite the meta description.`;
    },
    maxTokens: 80,
  },
  lms_lesson_generate: {
    kind: "lms_lesson_generate",
    label: "Generate lesson content",
    description: "Draft full lesson content from a topic, for a given subject and class level.",
    system: `${CORE_STYLE} You are writing lesson content for a school Learning Management System. Write clear, well-structured lesson content using markdown-style formatting (## headers, **bold** for key terms, numbered/bulleted lists where helpful). Explain the topic step by step at a level appropriate for the stated class/grade. Include a short worked example or illustration where it helps understanding. Do not include a title heading (the title is stored separately) -- start directly with the content. Return only the lesson content.`,
    compose: (input, extra) => {
      const subject = extra?.subject ?? "the subject";
      const grade = extra?.grade ?? "the class";
      const lessonTitle = extra?.lesson_title ?? input;
      return `Subject: ${subject}\nClass/Grade: ${grade}\nLesson topic: ${lessonTitle}\n${input && input !== lessonTitle ? `Additional brief: ${input}\n` : ""}\nWrite the lesson content.`;
    },
    maxTokens: 1200,
  },
  lms_quiz_generate: {
    kind: "lms_quiz_generate",
    label: "Generate quiz from lesson",
    description: "Turn lesson content into a multiple-choice quiz, as strict JSON.",
    system: `${CORE_STYLE} You generate multiple-choice quiz questions from lesson content for a school LMS. Return ONLY valid JSON (no markdown fences, no commentary, no leading/trailing text) matching exactly this shape: {"questions":[{"question_text":"...","options":[{"id":"a","text":"...","is_correct":true},{"id":"b","text":"...","is_correct":false},{"id":"c","text":"...","is_correct":false},{"id":"d","text":"...","is_correct":false}],"explanation":"..."}]}. Generate the number of questions requested. Exactly one option per question must have is_correct true. Base every question strictly on the given lesson content -- never invent facts not present in it. explanation should briefly state why the correct answer is correct.`,
    compose: (input, extra) => {
      const count = extra?.question_count ?? "5";
      return `Lesson content:\n${input}\n\nGenerate ${count} multiple-choice questions as the specified JSON.`;
    },
    maxTokens: 1600,
  },
  lms_grading_assist: {
    kind: "lms_grading_assist",
    label: "Suggest a grade",
    description: "Suggests a score and feedback for a student's free-text submission -- a teacher must review and confirm.",
    system: `${CORE_STYLE} You are a teaching assistant suggesting a grade for a student's assignment submission. You are NOT the final grader -- a human teacher reviews and can change everything you suggest. Return ONLY valid JSON (no markdown fences, no commentary) matching exactly: {"suggested_score":0,"feedback":"..."}. suggested_score is out of the max_score given, as a number. feedback is 2-4 sentences: specific, constructive, and references the assignment instructions and the student's actual response.`,
    compose: (input, extra) => {
      const instructions = extra?.instructions ?? "No instructions given.";
      const maxScore = extra?.max_score ?? "100";
      return `Assignment instructions:\n${instructions}\n\nMax score: ${maxScore}\n\nStudent's response:\n${input}\n\nSuggest a score and feedback as the specified JSON.`;
    },
    maxTokens: 400,
  },
  school_newsletter: {
    kind: "school_newsletter",
    label: "Draft a parent newsletter",
    description: "Term-end newsletter for parents, warmly summarising the term's highlights from a facts snapshot.",
    system: `${CORE_STYLE} You draft a school newsletter for parents. Structure: an opening paragraph from the head of school; a "**Highlights this term**" section with 3-5 bullet-style items grounded in the numbers provided; a "**Upcoming**" section (2-3 items); and a warm closing. Use **bold section labels**. Never invent statistics. Use warm British English and keep the whole thing under 350 words. Return only the newsletter text.`,
    compose: (input, extra) => {
      const school = extra?.school_name ?? "the school";
      const term = extra?.term ?? "this term";
      return `School: ${school}\nTerm: ${term}\nFacts snapshot:\n${input}\n\nDraft the newsletter.`;
    },
    maxTokens: 900,
  },
  expense_category_suggest: {
    kind: "expense_category_suggest",
    label: "Suggest expense category",
    description: "Given a short expense description, return the single best-matching category from the caller's allowed list.",
    system: `${CORE_STYLE} You classify a Nigerian K-12 school expense description into ONE category from an allowed list. Return the category name only, exactly as written in the allowed list — no punctuation, no explanation, no quotes.`,
    compose: (input, extra) => {
      const allowed = extra?.allowed ?? "Miscellaneous";
      return `Allowed categories (pick exactly one, verbatim): ${allowed}\nExpense description: ${input}\n\nCategory:`;
    },
    maxTokens: 20,
  },
  student_brief: {
    kind: "student_brief",
    label: "Brief me on this student",
    description: "One-paragraph overview drawn from the student's profile — for a teacher meeting a class for the first time.",
    system: `${CORE_STYLE} You are giving a Nigerian K-12 teacher a quick briefing on one student before class. Write 3-5 sentences: who they are, key context (guardian, contact), any noted allergies/medical concerns if provided, and one specific thing the teacher should keep in mind. NEVER invent details — if a field is missing, do not mention it. Keep it warm and professional. Return only the paragraph.`,
    compose: (input) => `Student profile facts (raw):\n${input}\n\nWrite the briefing paragraph.`,
    maxTokens: 250,
  },
  analytics_digest: {
    kind: "analytics_digest",
    label: "Draft an executive analytics digest",
    description: "Turn a JSON snapshot of the school's KPIs into a warm, plain-English digest a principal can share.",
    system: `${CORE_STYLE} You are drafting a short executive digest for a school principal, from the KPI snapshot they provide as JSON. Write 4-6 short paragraphs, each with a bold-tagged section header ("**Enrolment**", "**Finance**", "**Attendance**", "**Academics**", "**Attention needed**", "**Next step**") followed by 1-3 sentences of specific observations grounded strictly in the numbers given. Compare to prior period when the JSON supplies one. Do NOT invent data. Close with 1-2 concrete suggested actions for this week. Use British English and warm, direct tone. Return the digest text only.`,
    compose: (input) => `KPI snapshot:\n${input}\n\nWrite the executive digest.`,
    maxTokens: 800,
  },
  student_term_summary: {
    kind: "student_term_summary",
    label: "Draft term summary for parents",
    description: "Warm, honest paragraph summarising a student's academic performance, attendance and behaviour for the term — for a parent-teacher meeting or a report-card cover note.",
    system: `${CORE_STYLE} You are drafting a parent-facing term summary for a school. Write ONE paragraph (5-7 sentences), warm, honest, specific. Reference the actual scores, attendance figures and any comments provided — NEVER invent details. Lead with a genuine strength, name the challenge kindly, then a concrete next step for the coming term. Use the student's first name. Return only the paragraph.`,
    compose: (input, extra) => {
      const name = extra?.student_name ?? "the student";
      const grade = extra?.grade ?? "";
      const term = extra?.term ?? "this term";
      const avg = extra?.average ?? "";
      const position = extra?.position ?? "";
      const attendance = extra?.attendance ?? "";
      return `Student: ${name}\nClass: ${grade}\nTerm: ${term}\nAverage: ${avg}\nPosition in class: ${position}\nAttendance: ${attendance}\n\nTeacher notes / raw comments:\n${input}\n\nWrite the term summary.`;
    },
    maxTokens: 350,
  },
  lms_bulk_parse: {
    kind: "lms_bulk_parse",
    label: "Parse into course structure",
    description: "Turn arbitrary lesson notes/curriculum text into strict {lessons:[{title,content,quiz:{questions:[...]}]}} JSON.",
    system: `${CORE_STYLE} You extract course structure from teacher-supplied notes. Return ONLY valid JSON (no markdown fences, no commentary) matching exactly: {"course_description":"...","lessons":[{"title":"...","content":"...","estimated_minutes":15,"quiz":{"pass_mark_percent":50,"questions":[{"question_text":"...","options":[{"id":"a","text":"...","is_correct":true},{"id":"b","text":"...","is_correct":false},{"id":"c","text":"...","is_correct":false},{"id":"d","text":"...","is_correct":false}],"explanation":"..."}]}}]}. Rules: (1) course_description is 2-3 sentences summarising the whole material. (2) Each lesson.title is a concrete topic (5-9 words). (3) lesson.content is the full teacher-facing body of the lesson in plain paragraphs — DO NOT summarise; keep facts, examples and lists intact. Use ## headers, **bold** and bullet lists where the source used them. (4) estimated_minutes is your best estimate of how long the lesson takes. (5) EVERY lesson MUST have a quiz object with 3-5 multiple-choice questions grounded strictly in that lesson's content — no invented facts. Each question has exactly 4 options, exactly one is_correct true. explanation is 1-2 sentences on why. (6) If the source is a table/spreadsheet with a lesson-per-row shape (columns like title/topic/content/objective), preserve that mapping precisely. (7) If the source is prose, split it into logical lessons where a heading, "Lesson N", or a topic shift naturally divides the material — never merge unrelated topics. Do not add lessons the source did not describe. Do not exceed a reasonable amount of output — aim for 3-15 lessons unless the source clearly has more.`,
    compose: (input, extra) => {
      const subject = extra?.subject ?? "";
      const grade = extra?.grade ?? "";
      return `Subject: ${subject}\nClass/Grade: ${grade}\n\nSource material follows. Extract the course structure as the specified JSON.\n\n----- SOURCE START -----\n${input}\n----- SOURCE END -----`;
    },
    maxTokens: 6000,
  },
  lms_course_outline: {
    kind: "lms_course_outline",
    label: "Generate course outline",
    description: "Given a subject and class level, draft a term-long course outline as a list of lesson titles with brief objectives.",
    system: `${CORE_STYLE} You are drafting a term-long course outline for a school Learning Management System. Return ONLY valid JSON (no markdown fences, no commentary) matching exactly: {"course_description":"...","lessons":[{"title":"...","objective":"..."}]}. course_description is 2-3 sentences describing the course. Generate the number of lessons requested. Each lesson.title is a short concrete topic (5-9 words); each lesson.objective is one sentence stating what a student will be able to do after the lesson. Progress logically from foundational to advanced across the term. Match the subject and class level given.`,
    compose: (input, extra) => {
      const subject = extra?.subject ?? "the subject";
      const grade = extra?.grade ?? "the class";
      const count = extra?.lesson_count ?? "10";
      const brief = input || "Standard term-long curriculum.";
      return `Subject: ${subject}\nClass/Grade: ${grade}\nRequested lessons: ${count}\nAdditional brief: ${brief}\n\nGenerate the outline as the specified JSON.`;
    },
    maxTokens: 1400,
  },
  free_form: {
    kind: "free_form",
    label: "Free-form prompt",
    description: "Whatever you want — full control over the prompt.",
    system: CORE_STYLE,
    compose: (input) => input,
    maxTokens: 600,
  },
  // Backing preset for the always-available "assistant" FAB (/api/ai/assistant).
  // Unlike free_form, the system prompt here is fixed and never supplied by
  // the caller — this preset is reachable by every signed-in role (parents,
  // students included), so it must not be able to be steered into acting as
  // a general-purpose, unscoped assistant.
  assistant_help: {
    kind: "assistant_help",
    label: "Platform help",
    description: "Internal: powers the always-available help chat FAB.",
    system:
      "You are a friendly help assistant for a Nigerian K-12 school-management platform. " +
      "Answer briefly and practically, in plain British English. If the user asks 'how do I…', " +
      "point to the correct dashboard section and the steps to get there. You do not have access " +
      "to live school data — if asked about a specific number or record, tell them where in the " +
      "platform to look it up instead of guessing. Stay strictly on how-to-use-the-platform topics; " +
      "for anything else, say it's outside what you can help with here.",
    compose: (input, extra) => {
      const page = extra?.page ? `Current page: ${extra.page}\n\n` : "";
      return `${page}USER QUESTION:\n${input}`;
    },
    maxTokens: 400,
  },
  // Internal only — used by the "Test connection" button on the AI Provider
  // settings pages (platform + school-level), never shown in AI Studio's
  // preset picker. Deliberately tiny maxTokens: this exists purely to prove
  // the provider/model/key combination actually works end to end, not to
  // produce useful output.
  connection_test: {
    kind: "connection_test",
    label: "Connection test",
    description: "Internal: verifies a provider/model/key actually works.",
    system: "Reply with exactly one word: OK",
    compose: () => "Reply with exactly one word: OK",
    maxTokens: 10,
  },
  // Communication / chat assist (staff-only — /api/ai/generate enforces this).
  // AI never sends on the user's behalf: every one of these returns text
  // into the composer for the sender to review before hitting Send.
  message_polish: {
    kind: "message_polish",
    label: "Polish message",
    description: "Tidy grammar and tone for a school message, keep it brief.",
    system: `${CORE_STYLE} Rewrite this chat message to a parent, student, or colleague: fix grammar, keep it warm and professional, keep it about the same length. Return only the rewritten message, no quotes.`,
    compose: (input) => input,
    maxTokens: 300,
  },
  message_shorten: {
    kind: "message_shorten",
    label: "Shorten message",
    description: "Trim a draft message to its essential point.",
    system: `${CORE_STYLE} Shorten this chat message to its essential point in one or two sentences, keeping the key facts (names, dates, numbers). Return only the rewritten message.`,
    compose: (input) => input,
    maxTokens: 200,
  },
  message_translate: {
    kind: "message_translate",
    label: "Translate message",
    description: "Translate a draft or received message into another language.",
    system: `${CORE_STYLE} Translate the given message accurately, preserving names, dates and numbers exactly. If a target language is specified, use it; otherwise use clear, simple English. Return only the translation.`,
    compose: (input, extra) => {
      const lang = extra?.target_language?.trim();
      return lang ? `Target language: ${lang}

Message:
${input}` : input;
    },
    maxTokens: 300,
  },
  message_announcement_draft: {
    kind: "message_announcement_draft",
    label: "Draft announcement",
    description: "Turn rough notes into a polished announcement-channel post.",
    system: `${CORE_STYLE} You are drafting a school announcement to be posted in an announcement channel. Turn the notes into a clear, well-organized notice: a short heading line, then 2-5 sentences or a brief list of the key details (dates, actions required, who it affects). Return only the announcement text.`,
    compose: (input) => input,
    maxTokens: 400,
  },
  message_thread_summary: {
    kind: "message_thread_summary",
    label: "Summarize conversation",
    description: "Summarize a long or unread group conversation.",
    system: `${CORE_STYLE} Summarize this chat conversation for someone who has not read it. 3-6 bullet-style sentences (write them as short sentences, not literal bullet characters): who said what of substance, any decisions or action items, and anything requiring a response. Skip greetings and small talk.`,
    compose: (input) => input,
    maxTokens: 350,
  },
};

export function presetOptions(): Array<{ value: AiTaskKind; label: string; description: string }> {
  return (Object.keys(AI_PRESETS) as AiTaskKind[]).map((k) => ({
    value: k,
    label: AI_PRESETS[k].label,
    description: AI_PRESETS[k].description,
  }));
}
