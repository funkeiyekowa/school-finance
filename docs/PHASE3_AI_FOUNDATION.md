# Phase 3 — AI Foundation

Phase 3 adds a small, grounded student study surface on top of the existing AI provider and audit infrastructure. It does not add a provider, vector database, autonomous agent, or new secret.

## Request flow

Student AI requests follow this sequence:

`authenticated user → role check → organization-bound student → published lesson → active enrollment → active-exam check → redacted lesson source → existing provider → ai_generation_log`

The shared `runAiCompletion` path resolves the existing organisation/provider configuration, applies the selected task preset, records best-effort usage and error metadata, and returns a generic failure to the client when the provider is unavailable.

## Student features

- `/api/ai/lms-study-help` answers a question using only the selected published lesson.
- `/api/ai/lms-practice` generates grounded practice questions or flashcards from that lesson.
- The lesson viewer exposes both actions and labels generated material as requiring review.

The server never accepts lesson content from the browser. It requires a student role, the caller's own student profile in the current organisation, an active course enrolment, and no in-progress exam attempt. Empty or unavailable lesson content fails closed. Common contact identifiers in lesson content are redacted before the provider call.

Generated practice content is not an official grade, result, attendance record, or other authoritative school record. The API validates the JSON shape before returning it and caps the requested item count.

## Configuration

No new environment variables or external services are required. The existing AI provider configuration remains the source of truth: a platform provider environment key or an organisation provider setting must be configured for the school. Existing optional Upstash variables continue to provide shared rate limiting when present; otherwise the established local fallback is used.

## Verification still required

Automated contract tests cover authorization lookups, source grounding, redaction, provider-path reuse, output validation, and the UI wiring. Live verification is still required with Supabase student accounts from two organisations, an enrolled and non-enrolled student, an active exam attempt, and a configured provider. This work does not claim to have proven live RLS, tenant isolation, provider billing, or production model behaviour.

Parent-facing grounded AI is intentionally deferred until linked-child and sensitive-record verification can be exercised with live accounts.
