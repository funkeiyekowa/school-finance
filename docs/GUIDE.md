# School Finance Suite — Complete Operations Guide

> Version 1.0 · August 2026
>
> This document covers everything needed to set up, operate, and maintain the platform. It is divided into two parts: **Technical** (for developers and system administrators) and **Functional** (for school administrators and staff using the application daily).

---

## Table of Contents

### Part 1: Technical Guide
1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Environment Setup](#environment-setup)
4. [Database Migrations (Run Order)](#database-migrations-run-order)
5. [Environment Variables](#environment-variables)
6. [Deployment (Vercel)](#deployment-vercel)
7. [Multi-Tenancy Model](#multi-tenancy-model)
8. [Row-Level Security (RLS)](#row-level-security-rls)
9. [Adding a New Module](#adding-a-new-module)
10. [Troubleshooting](#troubleshooting)

### Part 2: Functional Guide
11. [Platform Administration](#platform-administration)
12. [Provisioning a New School](#provisioning-a-new-school)
13. [The Join Code System](#the-join-code-system)
14. [User Registration and Approval](#user-registration-and-approval)
15. [Organization Switching](#organization-switching)
16. [Roles and Permissions](#roles-and-permissions)
17. [Module Management](#module-management)
18. [Tenant Isolation Verification](#tenant-isolation-verification)
19. [Website Studio](#website-studio)
20. [Enquiries and Leads](#enquiries-and-leads)
21. [Finance Operations](#finance-operations)
22. [Student Management](#student-management)
23. [Common Workflows](#common-workflows)

---

# Part 1: Technical Guide

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      BROWSER                            │
│  Next.js App (React)  ─── Supabase JS Client ──────┐   │
└──────────────────────────────────────────────────────┼──┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────┐
│                 VERCEL (Edge + Serverless)               │
│                                                         │
│  Middleware (Edge)          API Routes (Node.js)        │
│  - Host-to-tenant routing   - Isolation test suite      │
│  - Session refresh          - SMS/Email webhooks        │
└──────────────────────────────────────────────────────┼──┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────┐
│                     SUPABASE                            │
│                                                         │
│  PostgreSQL         Auth (GoTrue)       Storage         │
│  - All data         - Email/password    - Media files   │
│  - RLS policies     - Google OAuth      - Per-org paths │
│  - RPC functions    - JWT tokens                        │
└─────────────────────────────────────────────────────────┘
```

The platform is a **multi-tenant SaaS**. Every school (tenant) shares the same database, but Row-Level Security ensures one school can never read or write another school's data.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React, TypeScript, Tailwind CSS |
| Backend | Supabase (PostgreSQL + Auth + Storage + Realtime) |
| Hosting | Vercel (auto-deploys from GitHub) |
| Auth | Supabase Auth (email/password + Google OAuth) |
| Database | PostgreSQL with RLS (Row-Level Security) |
| Storage | Supabase Storage (media library) |

---

## Environment Setup

### Prerequisites

- Node.js 18+ installed
- Git installed
- A GitHub account (connected to Vercel)
- A Supabase project (free tier works)

### Local Development

```bash
# 1. Clone the repository
git clone https://github.com/funkeiyekowa/school-finance.git
cd school-finance

# 2. Install dependencies
npm install

# 3. Create your environment file
copy .env.local.example .env.local
# Then edit .env.local with your Supabase credentials

# 4. Start the development server
npm run dev

# 5. Open http://localhost:3000
```

---

## Database Migrations (Run Order)

Run these SQL files in the **Supabase SQL Editor** in exactly this order. Each one depends on the previous.

| # | File | What it does |
|---|------|-------------|
| 1 | `supabase/schema.sql` | Creates base tables: profiles, school_settings, roles, students, vendors, income, expenses, etc. |
| 2 | `supabase/dynamic_categories_migration.sql` | Adds the categories table |
| 3 | `supabase/promotion_system_migration.sql` | Adds classes, academic_years, student_enrollments, promotions |
| 4 | `supabase/attendance_migration.sql` | Adds subjects, attendance tables |
| 5 | `supabase/assessments_migration.sql` | Adds assessments and gradebook |
| 6 | `supabase/cbt_migration.sql` | Adds CBT/online exam tables |
| 7 | `supabase/timetable_migration.sql` | Adds timetable tables |
| 8 | `supabase/operations_migration.sql` | Adds staff, inventory tables |
| 9 | `supabase/automations_migration.sql` | Adds alert policies |
| 10 | `supabase/multi_tenant_migration.sql` | **Critical**: Creates organizations, memberships, subscriptions. Adds organization_id to all tables. |
| 11 | `supabase/tenant_isolation_enforcement.sql` | Makes organization_id NOT NULL, creates tenant-scoped RLS policies |
| 12 | `supabase/saas_foundation.sql` | Hardens policies, adds org switching, membership RPCs, verification functions |
| 13 | `supabase/fix_rls_leaks.sql` | Removes any leftover permissive policies that bypass tenant isolation |
| 14 | `supabase/fix_profile_isolation.sql` | Scopes profiles to tenant, adds join codes for registration |
| 15 | `supabase/website_module.sql` | Website & Digital Presence module (themes, pages, sections, media, news, events, forms, domains) |
| 16 | `supabase/bootstrap_grant_schools.sql` | **Edit first!** Sets up your admin account and names the primary school |

### Important notes:
- **Migration 16 requires editing**: Open the file and change `v_admin_email` to your login email before running.
- All migrations are **idempotent** — safe to run again if something fails partway through.
- Run them in a single session for best results. If one fails, fix the issue and re-run just that one.

---

## Environment Variables

### `.env.local` (local development)

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...your-anon-key
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...your-service-role-key
```

### Where to find these values

1. Go to **Supabase Dashboard** → your project
2. Click **Settings** (gear icon) → **API**
3. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

### Rules

| Variable | `NEXT_PUBLIC_` prefix? | Exposed to browser? | Purpose |
|----------|----------------------|--------------------:|---------|
| SUPABASE_URL | YES | Yes | The browser-side client needs this to talk to Supabase |
| SUPABASE_ANON_KEY | YES | Yes | Safe to expose — RLS policies restrict what it can do |
| SUPABASE_SERVICE_ROLE_KEY | NO | **Never** | Bypasses ALL security. Server-only. Used only by the isolation test suite. |

### Optional

| Variable | When needed |
|----------|-------------|
| `NEXT_PUBLIC_PLATFORM_HOST` | Only when you have a registered domain and want subdomain routing (e.g., `greenfield.yourdomain.com`) |

---

## Deployment (Vercel)

### Initial Setup

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project**
3. Import your GitHub repository
4. Vercel auto-detects Next.js — no configuration needed
5. Add your environment variables under **Settings → Environment Variables**
6. Click **Deploy**

### Ongoing Deployments

Every `git push` to the `main` branch triggers an automatic deployment:

```bash
git add -A
git commit -m "your change description"
git push origin main
```

Vercel builds and deploys in ~1-2 minutes. You can watch progress at vercel.com/dashboard.

### Deploy from Kiro IDE

If you're working in Kiro, the steps are the same — use the Terminal panel at the bottom:

```bash
git add -A
git commit -m "description of what changed"
git push origin main
```

---

## Multi-Tenancy Model

```
Platform
├── Organization A (Grant Schools)
│   ├── Members (6 users)
│   ├── Students, Income, Expenses...
│   ├── Subscriptions (25 modules)
│   └── Website
├── Organization B (Olly Schools)
│   ├── Members (2 users)
│   ├── Students, Income, Expenses...
│   ├── Subscriptions (5 modules)
│   └── Website
└── Organization C (Flotual Schools)
    ├── Members (1 user)
    └── ...
```

### Key concepts

- **Organization** = a school/tenant
- **Membership** = a user's relationship to a school (role + active status)
- **A user can belong to multiple schools** but sees exactly one at a time
- **`current_user_org_id()`** = the SQL function that returns which school the signed-in user is operating as right now
- **Switching** = moving the `is_default` flag on `org_memberships`, which changes what `current_user_org_id()` returns

### How a request resolves to a tenant

1. User signs in → gets a JWT with their `user_id`
2. Every database query runs through RLS
3. RLS calls `current_user_org_id()` which reads `org_memberships WHERE user_id = auth.uid() AND is_default = true`
4. The policy says: only show rows where `organization_id = current_user_org_id()`
5. Result: the user sees only their school's data

---

## Row-Level Security (RLS)

Every tenant-owned table has this pattern:

```sql
-- Only your school's rows
CREATE POLICY "tenant_table_select" ON table_name FOR SELECT
  USING (organization_id = current_user_org_id());

CREATE POLICY "tenant_table_insert" ON table_name FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_table_update" ON table_name FOR UPDATE
  USING (organization_id = current_user_org_id());

CREATE POLICY "tenant_table_delete" ON table_name FOR DELETE
  USING (organization_id = current_user_org_id());
```

### PostgreSQL RLS is OR-based

If a table has multiple SELECT policies, a row is visible if **ANY** policy passes. This means a single leftover permissive policy (like "Active users can read all") defeats the entire tenant isolation.

### Service role bypasses RLS

The `SUPABASE_SERVICE_ROLE_KEY` skips all policies. This is by design — webhooks (SMS, email) need to write without a user session. Never expose this key to the browser.

---

## Adding a New Module

1. **Register it** in the module catalogue:
   ```sql
   INSERT INTO platform_modules (key, name, category, is_core, sort_order)
   VALUES ('my_module', 'My Module', 'academic', false, 30);
   ```

2. **Create its tables** with `organization_id NOT NULL`, RLS enabled, and tenant-scoped policies.

3. **Add a nav item** in `src/components/layout/AppShell.tsx`:
   ```typescript
   { href: "/dashboard/my-module", label: "My Module", icon: <Icon size={18} />, module: "my_module" },
   ```

4. **Add a layout guard** at `src/app/dashboard/my-module/layout.tsx`:
   ```typescript
   import { ModuleGuard } from "@/lib/guards/module-guard";
   export default function Layout({ children }) {
     return <ModuleGuard module="my_module">{children}</ModuleGuard>;
   }
   ```

5. **Enable it** for a school in Platform Admin → Schools → Modules.

---

## Troubleshooting

### 504 MIDDLEWARE_INVOCATION_TIMEOUT

**Cause**: The middleware tried to refresh the Supabase session and Supabase was too slow to respond.

**Fix**: Already fixed in the codebase. The middleware only calls `getUser()` on `/dashboard` routes and wraps it in a try/catch. If you see this again, check if Supabase is having an outage.

### User sees "No users yet" in Team

**Cause**: The user's `org_memberships` records don't exist or the org_id doesn't match.

**Fix**: Check in Platform Admin → Members that the user is listed under the correct school.

### User stuck on "Waiting for approval"

**Cause**: Their `profiles.active = false`.

**Fix**: Go to Team → find them → click Approve. Or run:
```sql
UPDATE profiles SET active = true WHERE email = 'their@email.com';
```

### User shows "PENDING" in sidebar but is active in Team

**Cause**: Their `profiles.role` is still `'pending'` from initial registration, even though their membership is active.

**Fix**:
```sql
UPDATE profiles p
SET role = m.role, active = true
FROM org_memberships m
WHERE m.user_id = p.id AND m.active = true AND m.is_default = true
  AND p.role = 'pending';
```

### Created an organization but can't see it

**Cause**: The organization has no members, and RLS only shows orgs you're a member of.

**Fix**: Run `bootstrap_grant_schools.sql` (after editing the email), or manually insert a membership:
```sql
INSERT INTO org_memberships (user_id, organization_id, role, is_default, active)
VALUES ('your-user-uuid', 'the-org-uuid', 'super_admin', true, true);
```

### Tenant isolation test fails

**Cause**: Old RLS policies from `schema.sql` were not properly removed.

**Fix**: Run `supabase/fix_rls_leaks.sql` — it dynamically finds and drops any policy that doesn't reference `current_user_org_id()`.

---

# Part 2: Functional Guide

---

## Platform Administration

Platform Admin is accessible only to **super admins** and **developers**. It is the control centre for the entire SaaS.

### Accessing it
Sidebar → **Platform Admin** (only visible if you're a platform admin)

### What you can do here

| Tab | Purpose |
|-----|---------|
| Schools | Create, edit, and manage all organizations on the platform |
| Members | View and manage which users belong to which school |
| Module catalogue | See all available modules and how many schools subscribe to each |

### Platform Admin vs School Admin

| Capability | Platform Admin | School Admin |
|------------|:--------------:|:------------:|
| Create new schools | Yes | No |
| See all schools | Yes | No |
| Assign users to any school | Yes | No |
| Enable/disable paid modules | Yes | No |
| Enter any school (support) | Yes | No |
| Manage their own school's team | Yes | Yes |
| Approve users for their school | Yes | Yes |

---

## Provisioning a New School

### Step-by-step

1. Sign in as a **platform admin**
2. Go to **Platform Admin** → click **+ New School**
3. Fill in:
   - **School name**: e.g., "Greenfield Academy"
   - **Slug**: auto-generated from name, or type your own (e.g., `greenfield-academy`)
   - **Contact email**: the school's main email
   - **Plan**: Starter / Standard / Premium / Enterprise
   - **Status**: Usually "Trial" for new schools
   - **Owner email** (optional): if the principal already has an account, enter their email — they become the school owner immediately
   - **Auto-join email domain** (optional): e.g., `greenfield.edu` — anyone who registers with a `@greenfield.edu` email joins this school automatically
4. Click **Provision school**

### What provisioning creates automatically

- The organization record
- A set of default roles (admin, bursar, editor, teacher, viewer)
- A school_settings row
- Core module entitlements (finance, students)
- A unique **join code** for staff registration

---

## The Join Code System

Every school has a **join code** — a short alphanumeric code (e.g., `AB3F9K`) that identifies it during registration.

### Where to find it

- **Platform Admin → Members** → pick the school → the code is shown in the panel header
- **Team → Invite User** → the code is displayed prominently with a Copy button

### How it works

1. School admin shares the code with their staff: "Register at our-app.vercel.app and use code AB3F9K"
2. New user registers → enters the code → the system connects them to that school
3. They land on "Waiting for approval"
4. The school admin goes to Team → approves them

### Regenerating a code

If a code leaks to people who shouldn't have it:
- **Team → Invite User → "Generate new code"**
- The old code stops working immediately

### Why this exists

Without a join code, a new user has no way to specify which school they're joining. They'd create a profile floating in space, visible to every admin on the platform. The join code pins them to the correct school from the moment they register.

---

## User Registration and Approval

### For the new user

1. Go to the app URL (e.g., `school-finance-navy.vercel.app`)
2. Click **Register**
3. Fill in:
   - Full name
   - **School code** (get this from your school admin)
   - Email
   - Password
4. After registering, you see "Waiting for approval"
5. Once approved by your school admin, sign in → you're in

### For the school admin

1. Go to **Team** in the sidebar
2. Pending users appear in an amber banner at the top
3. Choose a role from the dropdown, then click **Approve**
4. The user can now sign in and access the school's data

### Registration via Google

Users can also click "Continue with Google". After OAuth completes, they land on the pending page where they enter their school code (if they don't already have a membership).

---

## Organization Switching

If a user belongs to multiple schools, they can switch between them.

### How to switch

1. Look at the **top of the sidebar** — it shows your current school name
2. Click it → a dropdown appears listing all schools you belong to
3. Click a different school → the system switches your context
4. The page reloads showing the new school's data

### What happens technically

Switching calls `switch_active_org()` which moves the `is_default` flag on your membership. This changes what `current_user_org_id()` returns, which changes what every RLS policy shows you. It's a server-side operation, not just a UI toggle.

### Platform admin support access

Platform admins see all schools in the switcher (marked "Support access"). Entering a school this way creates a temporary membership so RLS resolves correctly. A yellow banner warns: "Support session — changes affect this school's live data."

---

## Roles and Permissions

### Membership roles (per school)

| Role | Access level |
|------|-------------|
| `super_admin` | Platform-wide. Can manage all schools. |
| `owner` | Full control of their school |
| `admin` | Everything except billing and platform settings |
| `bursar` | Finance operations (income, expenses, reports, reconciliation) |
| `accountant` | Finance, read-heavy |
| `editor` | Record and edit transactions |
| `staff` | General access |
| `teacher` | Teaching modules (assessments, attendance, portal) |
| `parent` | Parent portal only |
| `student` | Student portal only |
| `viewer` | Read-only |

### How permissions resolve

1. The system looks at your **membership role** in the active school
2. It finds the matching **role definition** (which has a JSON permissions object)
3. That determines which sidebar items and features you can access
4. Owners, admins, and super admins always get full permissions

### Changing a user's role

- **School admin**: Team → find the user → use the Role dropdown → select new role
- **Platform admin**: Platform Admin → Members → pick the school → change the role

---

## Module Management

Modules are product features that schools subscribe to. A school only sees and can access the modules enabled for it.

### Core modules (always enabled)

- Finance
- Students

### Optional modules

| Module | What it provides |
|--------|-----------------|
| Attendance | Daily attendance tracking |
| Timetable | Class scheduling |
| Assessments | Gradebook and assessments |
| CBT | Computer-based testing / online exams |
| HR / Staff | Staff management |
| Inventory | Stock and supplies |
| Communication | Announcements |
| Website | Public school website builder |
| CRM / Enquiries | Lead management from website forms |
| Parent Portal | Parent-facing features |
| Student Portal | Student-facing features |
| Teacher Portal | Teacher-facing features |

### Enabling/disabling a module

1. **Platform Admin → Schools tab**
2. Click **Modules** next to the school
3. Check/uncheck modules
4. The change is immediate — if a user navigates to a disabled module's URL, they see a "Module Not Available" block

### Module enforcement

Modules are enforced at two levels:
- **Sidebar**: disabled modules don't appear in the navigation
- **Server-side guard**: even if someone navigates directly to the URL, the `ModuleGuard` component blocks rendering with a clear message

---

## Tenant Isolation Verification

This feature proves mathematically that one school cannot reach another school's data.

### Running the verification

1. Go to **Platform Admin → Verify Isolation** (or click the shield icon)
2. Two checks are available:

**Schema posture** (runs automatically):
- Checks every tenant table has RLS enabled
- Checks policies reference `current_user_org_id()`
- Checks no NULL organization_id values exist
- Reports any wide-open policies

**Cross-tenant attack suite** (click "Run isolation suite"):
- Creates two temporary schools with real user accounts
- Signs in as each user
- Attempts to read, update, delete, and insert across the tenant boundary
- Reports pass/fail for each attempt
- Cleans up all test data afterwards

### Reading the results

- **Green banner**: "Tenant isolation verified" — everything passes
- **Red banner**: Something failed — scroll down to see which test and why
- **"Critical breaches"**: means actual data leaked across tenants — fix immediately

### Requirement

The isolation suite requires `SUPABASE_SERVICE_ROLE_KEY` to be set (it needs to create temporary users and orgs). Without it, you'll see a clear error message explaining what's needed.

---

## Website Studio

Each school can have its own public website, built and managed from within the app.

### Accessing it

Sidebar → **Website Studio** (requires the `website` module to be enabled)

### First-time setup

1. Choose a starting theme (5 are available)
2. The system creates a home page with starter sections
3. Edit the content, add your logo, set contact details
4. Click **Publish** when ready

### Tabs

| Tab | What you do there |
|-----|-------------------|
| Overview | Site name, tagline, maintenance mode, launch checklist |
| Theme & Brand | Choose theme, customize colours/fonts/logo, set contact details and social links |
| Pages & Sections | Add/remove pages, reorder sections, edit section content |
| News | Create and publish articles (appear on the website automatically) |
| Events | Create events (appear on the website automatically) |
| Media | Upload images and files for use across the site |
| SEO | Page title, meta description, social sharing image, search visibility |
| Domains | Platform subdomain and custom domain setup |
| History | Version snapshots — restore a previous state if something goes wrong |

### Public website URL

Before buying a domain: `your-app.vercel.app/s/school-slug`

Example: `school-finance-navy.vercel.app/s/grant-schools`

### Section types available

Hero, About, Principal's Message, Why Choose Us, Values, Programmes, Facilities, Statistics, Achievements, Testimonials, Staff, Gallery, Video, News (dynamic), Events (dynamic), FAQ, Admissions CTA, Contact, and more.

---

## Enquiries and Leads

When visitors submit a form on the school's public website, the submission lands in the Enquiries inbox.

### Accessing it

Sidebar → **Enquiries** (requires the `crm` module)

### Features

- Filter by status: New → Contacted → Qualified → Converted → Closed
- Filter by form type (contact, admissions, etc.)
- Search by name, email, or message content
- Open an enquiry to see full details + add internal notes
- Mark as spam (hidden from the main list)
- Delete permanently

### How submissions get here

1. A visitor fills out a form on the school's published website
2. The `submit_website_form()` function validates the email, rate-limits (3 per hour per email), and writes the row
3. The row is scoped to the school that owns the website
4. School staff see it in Enquiries; no other school can see it

---

## Finance Operations

### Income (Receipts)

- Record fee payments, donations, and other income
- Auto-generated receipt numbers (unique per school)
- Link to students for fee tracking
- Payment methods: Cash, Transfer, POS, Bank Deposit

### Expenses (Vouchers)

- Record all expenditures with voucher numbers
- Link to vendors
- Categories: Utilities, Salaries, Supplies, etc.
- Approval workflow

### Reconciliation

- Match bank statements against recorded transactions
- Flag unmatched items
- Mark transactions as reconciled

### Reports

- Income vs. Expense summaries
- Student balance reports
- Category breakdowns
- Period comparisons

---

## Student Management

### Student records

- Unique student codes (per school — two schools can use the same code)
- Personal details, guardian information
- Class assignment, academic year
- Status tracking (active, graduated, withdrawn)

### Promotion

- Batch promote students to the next class
- End-of-year workflows
- Academic year management

---

## Common Workflows

### Setting up a brand new school on the platform

1. Platform admin: **Platform Admin → + New School** → fill details → Provision
2. Platform admin: Note the **join code** (shown in Members tab)
3. Platform admin: Enable the modules the school is paying for
4. Share the join code with the school's principal
5. Principal registers, enters the code, gets approved (or auto-approved if configured)
6. Principal can now manage their school's Team, data, and website

### A new staff member joining an existing school

1. School admin: Go to **Team → Invite User** → copy the join code
2. Share with the new person: "Register at [app URL] and use code XXXXXX"
3. New person registers with the code
4. School admin: **Team** → see them in the pending section → Approve
5. Done — they can now sign in

### Verifying everything is secure after changes

1. Platform admin: **Platform Admin → Verify Isolation**
2. Click **Re-check schema** → all tables should show "pass"
3. Click **Run isolation suite** → all 22+ tests should pass
4. If anything fails: check the detail message, fix the RLS policy, re-run

### Publishing a school website

1. School admin: **Website Studio** → choose a theme
2. Edit the home page sections (click a section → Edit → fill in your content)
3. Upload your logo and photos in **Media**
4. Set contact details in **Theme & Brand**
5. Add a news article and an event
6. Check the **Launch checklist** — tick off items
7. Click **Preview** to see it
8. Click **Publish site** to make it live
9. Share the URL: `your-app.vercel.app/s/your-school-slug`

### Handling an enquiry from the website

1. A parent submits the contact form on your public site
2. You get a notification (or check periodically)
3. Go to **Enquiries** → see the new submission
4. Click **Open** → read the message
5. Change status to "Contacted" after you reply
6. Add notes: "Called back, tour booked for Friday"
7. Once they apply: change status to "Qualified" → "Converted"

---

## Glossary

| Term | Meaning |
|------|---------|
| **Tenant** | A school (organization) on the platform |
| **RLS** | Row-Level Security — database-level access control |
| **Org** | Short for organization (a school) |
| **Membership** | The link between a user and a school |
| **Join code** | The short code a school shares for registration |
| **Module** | A product feature that can be enabled/disabled per school |
| **Platform admin** | Someone who can manage ALL schools |
| **School admin** | Someone who can manage their own school |
| **Service role** | A special database key that bypasses all security (server-only) |
| **Anon key** | The browser-safe key that respects all RLS policies |

---

## Support Contacts

For technical issues with the platform infrastructure, contact the platform development team.

For school-level questions (how to use a feature, data corrections), the school admin is the first point of contact.

---

*End of document. This guide will be updated as new features are added.*
