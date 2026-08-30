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
  | "free_form";

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
  free_form: {
    kind: "free_form",
    label: "Free-form prompt",
    description: "Whatever you want — full control over the prompt.",
    system: CORE_STYLE,
    compose: (input) => input,
    maxTokens: 600,
  },
};

export function presetOptions(): Array<{ value: AiTaskKind; label: string; description: string }> {
  return (Object.keys(AI_PRESETS) as AiTaskKind[]).map((k) => ({
    value: k,
    label: AI_PRESETS[k].label,
    description: AI_PRESETS[k].description,
  }));
}
