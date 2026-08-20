# School Finance Suite — Deployment Guide

## Stack
- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend/Database**: Supabase (free tier)
- **Hosting**: Vercel (free tier)
- **Charts**: Recharts
- **PDF**: jsPDF + jsPDF-autotable

---

## Step 1 — Set up Supabase (free)

1. Go to https://supabase.com and create a free account
2. Create a new project (choose any region closest to Nigeria, e.g. `eu-west-2`)
3. Once the project is ready, go to **SQL Editor**
4. Paste the contents of `supabase/schema.sql` and click **Run**
5. Go to **Project Settings → API**
6. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Enable Google Auth (optional)
1. Go to **Authentication → Providers → Google**
2. Follow the instructions to connect your Google OAuth app
3. In Supabase **Authentication → URL Configuration**, set:
   - Site URL: `https://your-app.vercel.app`
   - Redirect URLs: `https://your-app.vercel.app/auth/callback`

---

## Step 2 — Deploy to Vercel (free)

### Option A: Via Vercel CLI
```bash
npm install -g vercel
cd school-finance
vercel
```

Follow the prompts. When asked for environment variables, add:
- `NEXT_PUBLIC_SUPABASE_URL` = your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your Supabase anon key

### Option B: Via Vercel Dashboard
1. Push this folder to a GitHub repo
2. Go to https://vercel.com → New Project → Import from GitHub
3. Select the repo
4. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Click Deploy

---

## Step 3 — First Login

1. Visit your Vercel deployment URL
2. Click **Register** to create the first account
3. **The first user automatically becomes Admin** (no approval needed)
4. All subsequent users will be **Pending** until you approve them in the **Team** section

---

## Step 4 — Set Up School Data

1. Go to **Setup → School Settings** → enter your school name, address, etc.
2. Go to **Setup → Fee Schedule** → add your term fees per grade
3. Go to **Students** → add your students
4. Go to **Vendors** → add your vendors/suppliers
5. Go to **Roles** → configure permissions for each role

---

## Google OAuth Setup

To enable "Continue with Google":

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create an OAuth 2.0 Client ID (Web application)
3. Set the authorized redirect URI to:
   `https://dqlsdocmjudzyzmqisrx.supabase.co/auth/v1/callback`
4. Copy the Client ID and Client Secret
5. In Supabase dashboard → Authentication → Providers → Google:
   - Enable Google provider
   - Paste Client ID and Client Secret
6. In Supabase → Authentication → URL Configuration:
   - Site URL: `https://school-finance-navy.vercel.app`
   - Redirect URLs: add `https://school-finance-navy.vercel.app/auth/callback`

---

## SMSGate Integration (Payment Alerts)

To receive automatic SMS payment alerts:

1. Deploy a Supabase Edge Function as webhook receiver
2. In the SMSGate Android app, register a webhook pointing to:
   `https://YOUR_PROJECT.supabase.co/functions/v1/smsgate-webhook`
3. Alerts will appear in **Payment Alerts** for staff review

---

## Free Tier Limits

| Service | Free Limit |
|---------|-----------|
| Supabase Database | 500 MB |
| Supabase Auth | 50,000 users |
| Vercel Bandwidth | 100 GB/month |
| Vercel Builds | Unlimited |

**This app costs ₦0 to run.**

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

Copy `.env.local.example` to `.env.local` for local development.
