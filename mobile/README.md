# Smart & Thrive mobile

Native Android and iOS client for the existing Smart & Thrive school platform.

## Phase 1 scope

- Secure persisted Supabase session using `expo-secure-store`
- School-slug sign-in with the same existing Supabase RPCs as the web portal
- Student-code and email sign-in
- Server-authoritative school/role validation
- Role-aware dashboard shell for student, parent, teacher/staff, and administrator users

No database tables, RLS policies, schema, or RPCs are changed by this mobile workspace.

## Local setup

1. Copy `.env.example` to `.env` and add the existing public Supabase URL and anon key.
2. From this `mobile` directory, run `npm install`.
3. Run `npm start`, then open it in Expo Go or an Android/iOS simulator.

For a production build, replace the placeholder app identifiers in `app.json` with identifiers your organisation owns before submitting to either app store.

## Existing backend contract used

- `resolve_school_brand_by_slug(p_slug)`
- `verify_student_code(p_code, p_org)`
- `resolve_login_context(p_slug)`
- `profiles`, `org_memberships`, and `organizations` (all subject to existing RLS)

The camera package is configured for later, user-initiated attendance/exam flows. Phase 1 does not request camera permission or capture images.
