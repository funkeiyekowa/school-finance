import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  ExternalLink,
  Globe2,
  GraduationCap,
  LockKeyhole,
  ShieldCheck,
  Users,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Start free | Smart & Thrive Academy",
  description: "Explore Smart & Thrive O/S safely inside the separate Smart & Thrive Academy demo tenant.",
};

const DEMO_HOME = "/s/smart-thrive-demo";
const STAFF_PORTAL = "/s/smart-thrive-demo/staff-portal";
const STUDENT_PARENT_LOGIN = "/s/smart-thrive-demo/login";

const roles = [
  {
    title: "Administrator",
    description: "Explore school setup, roles, oversight, and administrator workflows.",
    href: STAFF_PORTAL,
    email: "admin@demo.smartandthrive.com",
    password: "DemoAdmin123",
    icon: Building2,
  },
  {
    title: "Backoffice",
    description: "Review the operational workspace for finance and school administration.",
    href: STAFF_PORTAL,
    email: "backoffice@demo.smartandthrive.com",
    password: "DemoBackoffice123",
    icon: BriefcaseBusiness,
  },
  {
    title: "Teacher / Faculty",
    description: "Open the staff portal for teaching, classes, assessments, and related tools.",
    href: STAFF_PORTAL,
    email: "teacher@demo.smartandthrive.com",
    password: "DemoTeacher123",
    icon: BookOpenCheck,
  },
  {
    title: "Student",
    description: "Use the demo tenant login to access the student experience when an account is ready.",
    href: STUDENT_PARENT_LOGIN,
    email: "student@demo.smartandthrive.com",
    password: "DemoStudent123",
    icon: GraduationCap,
  },
  {
    title: "Parent",
    description: "Use the demo tenant login to explore the parent experience with a prepared account.",
    href: STUDENT_PARENT_LOGIN,
    email: "parent@demo.smartandthrive.com",
    password: "DemoParent123",
    icon: Users,
  },
] as const;

export default function StartFreePage() {
  return (
    <main className="min-h-screen bg-[#F8F5EC] px-5 py-8 text-[#0F2A47] sm:px-8 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold transition-colors hover:text-[#8A6D1A]"
          >
            <ArrowLeft size={16} /> Back to Smart & Thrive O/S
          </Link>
          <Link
            href={DEMO_HOME}
            className="inline-flex items-center gap-2 rounded-full border border-[#0F2A47]/15 bg-white px-4 py-2 text-sm font-semibold transition-colors hover:border-[#C9A227]"
          >
            <Globe2 size={16} className="text-[#C9A227]" /> Public demo website <ExternalLink size={14} />
          </Link>
        </div>

        <section className="mt-8 overflow-hidden rounded-[2rem] border border-[#C9A227]/25 bg-white shadow-[0_24px_80px_rgba(15,42,71,0.10)]">
          <div className="bg-[#0F2A47] px-7 py-10 text-white sm:px-10 lg:px-14 lg:py-14">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[#E5C85B]">
              <ShieldCheck size={14} /> Separate demo environment
            </div>
            <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Start free with Smart & Thrive Academy
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-slate-200 sm:text-lg">
              This demo uses a separate sample tenant. It is not Grant Schools and does not expose live school data.
            </p>
          </div>

          <div className="p-6 sm:p-8 lg:p-10">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8A6D1A]">Choose a workspace</p>
                <h2 className="mt-2 text-2xl font-bold">Explore the demo by role</h2>
              </div>
              <span className="hidden text-xs text-slate-500 sm:block">Smart & Thrive Academy · smart-thrive-demo</span>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {roles.map(({ title, description, href, icon: Icon }) => (
                <Link
                  key={title}
                  href={href}
                  className="group flex min-h-52 flex-col rounded-2xl border border-slate-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-[#C9A227] hover:shadow-lg"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FBF6E8] text-[#8A6D1A]">
                    <Icon size={19} />
                  </span>
                  <h3 className="mt-5 text-lg font-bold">{title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{description}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-[#8A6D1A]">
                    Open workspace <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>

            <div className="mt-8 grid overflow-hidden rounded-2xl border border-slate-200 lg:grid-cols-[1fr_auto]">
              <div className="p-6 sm:p-7">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <LockKeyhole size={17} className="text-[#C9A227]" /> Demo credentials
                </div>
                <div className="mt-4 space-y-3">
                  {roles.map(({ title, email, password }) => (
                    <div key={title} className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-[0.8fr_1.4fr_1fr] sm:items-center">
                      <div className="text-sm font-bold text-[#0F2A47]">{title}</div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Email</div>
                        <div className="mt-1 break-all font-mono text-xs font-semibold text-slate-700">{email}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Password</div>
                        <div className="mt-1 break-all font-mono text-xs font-semibold text-slate-700">{password}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  These public demo-safe accounts work only in the separate Smart & Thrive Academy tenant.
                </p>
              </div>
              <div className="flex items-center border-t border-slate-200 bg-[#FBF6E8] p-6 lg:border-l lg:border-t-0">
                <Link
                  href="/contact?subject=Request%20demo%20access"
                  className="inline-flex items-center gap-2 rounded-full bg-[#0F2A47] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#163B63]"
                >
                  Request demo access <ArrowRight size={15} />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
