import type { Metadata } from "next";
import Link from "next/link";
import LandingSignInChip from "./_landing/SignInChip";
import type { LucideIcon } from "lucide-react";
import {
  Users, DollarSign, ClipboardCheck, MonitorPlay,
  FileText, Globe, ArrowRight, Check, Sparkles,
  Building2, Import, KeyRound, Rocket,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Smart & Thrive O/S - One connected suite for your school",
  description:
    "Admissions, student finance, attendance, CBT, report cards and a parent-facing website — one connected operating system for your school.",
};

/* ------------------------------------------------------------------ */
/* Design tokens — kept local so the marketing page can evolve        */
/* independently of the app palette.                                  */
/* ------------------------------------------------------------------ */
const NAVY = "#0F2A47";
const GOLD = "#C9A227";
const CREAM = "#F7F5F0";
const HEADING_FONT = "\"Bricolage Grotesque\", \"Charter\", \"Georgia\", serif";
const BODY_FONT = "\"Karla\", \"Inter\", system-ui, -apple-system, sans-serif";

/* ------------------------------------------------------------------ */
/* Modules — only what actually exists in the app today.              */
/* ------------------------------------------------------------------ */
const MODULES: {
  icon: LucideIcon;
  title: string;
  desc: string;
  anchor: string;
}[] = [
  { icon: Users,          title: "Admissions & Enquiries", desc: "Capture every lead, guide it through interview, offer and enrolment — no lost prospects.", anchor: "#module-admissions" },
  { icon: DollarSign,     title: "Student Finance",        desc: "Fees, invoicing, receipts and per-child ledgers with bank reconciliation baked in.",       anchor: "#module-finance" },
  { icon: ClipboardCheck, title: "Attendance & Assessments", desc: "Daily register, per-subject scores and term-end grade books — one workflow.",           anchor: "#module-assessments" },
  { icon: MonitorPlay,    title: "CBT / Online Exams",     desc: "Timed, secure computer-based tests. Auto-marks objectives, tracks attempts.",             anchor: "#module-cbt" },
  { icon: FileText,       title: "Report Cards",           desc: "One-click term reports with your school's branding, remarks and cumulative averages.",     anchor: "#module-reports" },
  { icon: Globe,          title: "Website & Parent Portal", desc: "Publish your public site and give every parent a private dashboard from the same data.", anchor: "#module-website" },
];

const STEPS = [
  { icon: Building2, title: "We provision your school", desc: "Your organisation, domain and brand colours are set up — you don't touch a config file." },
  { icon: Import,    title: "Import your students",     desc: "Bring in your existing roster from a spreadsheet. We map classes, guardians and IDs." },
  { icon: KeyRound,  title: "Auto-provision accounts",  desc: "Every student gets a code; every parent an email invite; every teacher a staff login." },
  { icon: Rocket,    title: "Go live",                  desc: "Your public site is up, the portal is open, and receipts start flowing in on day one." },
];

const TIERS = [
  {
    name: "Starter",
    price: "$149",
    unit: "/month",
    tagline: "For small schools finding their footing.",
    features: ["Up to 150 students", "All core modules", "Standard email support", "Community help centre"],
    highlight: false,
  },
  {
    name: "Growth",
    price: "$349",
    unit: "/month",
    tagline: "For established schools scaling up.",
    features: ["Up to 500 students", "All core modules + CBT", "Priority support", "Onboarding session"],
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "",
    tagline: "Groups, chains and international schools.",
    features: ["Unlimited students", "Multi-campus consolidation", "Dedicated success manager", "Custom SLAs & SSO"],
    highlight: false,
  },
];

export default function LandingPage() {
  return (
    <div style={{ backgroundColor: CREAM, fontFamily: BODY_FONT, color: "#1a1a1a" }}>
      {/* Google Fonts — loaded via <link> in <head> for the two fonts we use */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@10..48,400;10..48,600;10..48,700&family=Karla:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />

      {/* ============================== NAV ============================== */}
      <header className="w-full border-b border-black/5">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <span
              className="inline-flex w-9 h-9 items-center justify-center rounded-md"
              style={{
                background: `linear-gradient(135deg, ${GOLD} 0%, #8a6d1a 100%)`,
                boxShadow: "0 6px 18px -6px rgba(201,162,39,0.55)",
              }}
              aria-hidden
            >
              <Sparkles size={18} className="text-white" />
            </span>
            <span className="font-semibold text-[15px]" style={{ color: NAVY, fontFamily: HEADING_FONT }}>
              Smart &amp; Thrive <span style={{ color: GOLD }}>O/S</span>
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm text-black/70">
            <a href="#modules" className="hover:text-black transition-colors">Modules</a>
            <a href="#how" className="hover:text-black transition-colors">How it works</a>
            <a href="#pricing" className="hover:text-black transition-colors">Pricing</a>
            <a href="/s/grant-schools" className="hover:text-black transition-colors">See it live</a>
          </nav>
          <div className="flex items-center gap-2">
            <LandingSignInChip />
            <a
              href="mailto:hello@smartandthrive.example?subject=Book%20a%20demo%20-%20Smart%20%26%20Thrive%20O%2FS"
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white transition-transform hover:-translate-y-px"
              style={{ backgroundColor: NAVY }}
            >
              Book a demo <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </header>

      {/* ============================== HERO ============================= */}
      <section className="relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 pt-16 pb-20 md:pt-24 md:pb-28 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold mb-6"
              style={{ backgroundColor: "rgba(201,162,39,0.12)", color: "#7a6314", border: `1px solid rgba(201,162,39,0.25)` }}
            >
              <Sparkles size={12} /> One operating system for your school
            </span>
            <h1
              className="text-4xl md:text-5xl lg:text-6xl leading-[1.05] tracking-tight"
              style={{ fontFamily: HEADING_FONT, color: NAVY, fontWeight: 700 }}
            >
              Run your school{" "}
              <span style={{ color: GOLD, fontStyle: "italic" }}>the way it should feel</span> to run one.
            </h1>
            <p className="mt-6 text-lg text-black/70 max-w-lg leading-relaxed">
              Admissions, finance, attendance, CBT, reports and a parent portal — one connected suite,
              built for the way real schools actually work.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="mailto:hello@smartandthrive.example?subject=Book%20a%20demo%20-%20Smart%20%26%20Thrive%20O%2FS"
                className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-px"
                style={{ backgroundColor: NAVY, boxShadow: "0 12px 28px -14px rgba(15,42,71,0.5)" }}
              >
                Book a demo <ArrowRight size={15} />
              </a>
              <a
                href="/s/grant-schools"
                className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-colors"
                style={{ backgroundColor: "white", color: NAVY, border: `1px solid ${NAVY}22` }}
              >
                See it live
              </a>
            </div>
            <p className="mt-5 text-xs text-black/50">
              No credit card. We set up your first school in under a week.
            </p>
          </div>

          {/* Premium illustration — inline SVG so CSP stays happy */}
          <div className="relative">
            <HeroIllustration />
          </div>
        </div>
        {/* Soft ambient background */}
        <div aria-hidden className="absolute inset-0 -z-10 opacity-70" style={{
          backgroundImage:
            `radial-gradient(600px 300px at 15% 20%, rgba(201,162,39,0.10), transparent), ` +
            `radial-gradient(500px 260px at 85% 30%, rgba(15,42,71,0.08), transparent)`,
        }} />
      </section>

      {/* ============================== TRUST BAR ======================== */}
      <section aria-label="Trust bar" className="border-y border-black/5 bg-white/70">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <p className="text-center text-[11px] uppercase tracking-[0.18em] text-black/40 mb-5">
            Trusted by schools across the region
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-6 items-center">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center justify-center h-10 rounded-md text-[11px] uppercase tracking-widest text-black/30 border border-dashed border-black/10">
                Your school here
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================== PROBLEM / SOLUTION =============== */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-3xl md:text-4xl" style={{ fontFamily: HEADING_FONT, color: NAVY, fontWeight: 700 }}>
            Stop juggling seven half-broken tools.
          </h2>
          <p className="mt-4 text-black/60">
            The average school runs on a spreadsheet, a WhatsApp group and hope. There&apos;s a better way.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { title: "Fragmented tools", body: "One system for finance, another for reports, a third for the parent group. Nothing talks to anything." },
            { title: "One connected suite", body: "Every module reads the same students, classes and ledgers. Change something once, it changes everywhere." },
            { title: "Real-time visibility", body: "Head-of-school dashboards show fees collected, attendance today and pending report cards — right now." },
          ].map((c, i) => (
            <div
              key={c.title}
              className="rounded-2xl p-6 md:p-7 border transition-transform hover:-translate-y-0.5"
              style={{
                backgroundColor: i === 1 ? NAVY : "white",
                color: i === 1 ? "white" : "#1a1a1a",
                borderColor: i === 1 ? NAVY : "rgba(0,0,0,0.06)",
                boxShadow: "0 10px 24px -18px rgba(15,42,71,0.25)",
              }}
            >
              <div className="text-[11px] uppercase tracking-widest mb-3" style={{ color: i === 1 ? GOLD : "#7a6314" }}>
                Step {i + 1}
              </div>
              <h3 className="text-xl mb-2" style={{ fontFamily: HEADING_FONT, fontWeight: 600 }}>{c.title}</h3>
              <p className={i === 1 ? "text-white/75" : "text-black/60"}>{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ============================== MODULE GALLERY =================== */}
      <section id="modules" className="bg-white border-y border-black/5">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="mb-12 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-black/40 mb-2">Modules</p>
              <h2 className="text-3xl md:text-4xl" style={{ fontFamily: HEADING_FONT, color: NAVY, fontWeight: 700 }}>
                Six modules. One codebase.
              </h2>
            </div>
            <p className="max-w-md text-black/60">
              Turn on what you need today. Everything is included in the base subscription — no module locks.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {MODULES.map((m) => (
              <div
                key={m.title}
                id={m.anchor.replace("#", "")}
                className="rounded-2xl p-6 border border-black/[0.06] bg-[#FBFAF6] transition-all hover:border-[#C9A227]/40 hover:shadow-md"
              >
                <div
                  className="w-11 h-11 rounded-lg flex items-center justify-center mb-4"
                  style={{ background: `linear-gradient(135deg, ${GOLD} 0%, #8a6d1a 100%)` }}
                >
                  <m.icon size={20} className="text-white" />
                </div>
                <h3 className="text-lg mb-1.5" style={{ fontFamily: HEADING_FONT, color: NAVY, fontWeight: 600 }}>
                  {m.title}
                </h3>
                <p className="text-sm text-black/60 leading-relaxed">{m.desc}</p>
                <a href={m.anchor} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold" style={{ color: NAVY }}>
                  Learn more <ArrowRight size={13} />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================== HOW IT WORKS ===================== */}
      <section id="how" className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-[11px] uppercase tracking-[0.18em] text-black/40 mb-2">How it works</p>
          <h2 className="text-3xl md:text-4xl" style={{ fontFamily: HEADING_FONT, color: NAVY, fontWeight: 700 }}>
            From zero to live in four steps.
          </h2>
        </div>
        <ol className="grid md:grid-cols-4 gap-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-2xl p-6 bg-white border border-black/[0.06]">
              <div className="text-[11px] font-semibold tracking-widest mb-4" style={{ color: GOLD }}>
                0{i + 1}
              </div>
              <div className="w-10 h-10 rounded-lg mb-4 flex items-center justify-center" style={{ backgroundColor: "rgba(15,42,71,0.06)", color: NAVY }}>
                <s.icon size={18} />
              </div>
              <h3 className="text-base mb-1.5" style={{ fontFamily: HEADING_FONT, color: NAVY, fontWeight: 600 }}>
                {s.title}
              </h3>
              <p className="text-sm text-black/60 leading-relaxed">{s.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ============================== PRICING ========================== */}
      <section id="pricing" className="bg-white border-y border-black/5">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <p className="text-[11px] uppercase tracking-[0.18em] text-black/40 mb-2">Pricing</p>
            <h2 className="text-3xl md:text-4xl" style={{ fontFamily: HEADING_FONT, color: NAVY, fontWeight: 700 }}>
              Simple plans. No module locks.
            </h2>
            <p className="mt-4 text-black/60">
              Everything in the base subscription. Only the student cap changes.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {TIERS.map((t) => (
              <div
                key={t.name}
                className="rounded-2xl p-7 border relative overflow-hidden"
                style={{
                  backgroundColor: t.highlight ? NAVY : "white",
                  color: t.highlight ? "white" : "#1a1a1a",
                  borderColor: t.highlight ? NAVY : "rgba(0,0,0,0.06)",
                  boxShadow: t.highlight ? "0 24px 48px -24px rgba(15,42,71,0.55)" : "0 10px 24px -18px rgba(15,42,71,0.15)",
                }}
              >
                {t.highlight && (
                  <span
                    className="absolute top-5 right-5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
                    style={{ backgroundColor: GOLD, color: NAVY }}
                  >
                    Most popular
                  </span>
                )}
                <h3 className="text-lg" style={{ fontFamily: HEADING_FONT, fontWeight: 600 }}>{t.name}</h3>
                <p className={`text-sm mt-1 ${t.highlight ? "text-white/70" : "text-black/60"}`}>{t.tagline}</p>
                <div className="mt-5 flex items-baseline gap-1">
                  <span className="text-4xl" style={{ fontFamily: HEADING_FONT, fontWeight: 700 }}>{t.price}</span>
                  <span className={t.highlight ? "text-white/70" : "text-black/50"}>{t.unit}</span>
                </div>
                <ul className="mt-5 space-y-2.5 text-sm">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check size={15} className="mt-0.5 shrink-0" style={{ color: t.highlight ? GOLD : NAVY }} />
                      <span className={t.highlight ? "text-white/85" : "text-black/70"}>{f}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="mailto:hello@smartandthrive.example?subject=Pricing%20enquiry%20-%20Smart%20%26%20Thrive%20O%2FS"
                  className="mt-7 inline-flex items-center justify-center w-full gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold transition-transform hover:-translate-y-px"
                  style={{
                    backgroundColor: t.highlight ? GOLD : NAVY,
                    color: t.highlight ? NAVY : "white",
                  }}
                >
                  Talk to us <ArrowRight size={14} />
                </a>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-xs text-black/40">
            *Custom quotes for schools &gt; 500 students. Prices in USD; billed monthly, cancel anytime.
          </p>
        </div>
      </section>

      {/* ============================== TESTIMONIAL ====================== */}
      <section className="max-w-4xl mx-auto px-6 py-20">
        <figure
          className="rounded-3xl p-8 md:p-10 border border-black/[0.06] bg-white relative"
          style={{ boxShadow: "0 24px 48px -24px rgba(15,42,71,0.18)" }}
        >
          <span className="absolute top-4 right-5 text-[10px] uppercase tracking-widest text-black/30">
            Illustrative — pilot testimonial
          </span>
          <blockquote className="text-xl md:text-2xl leading-relaxed" style={{ fontFamily: HEADING_FONT, color: NAVY, fontWeight: 500 }}>
            &ldquo;Every term used to end in a wall of spreadsheets. Now report cards
            publish the same night results are entered, and parents can actually
            find their child&apos;s balance. It&apos;s the calmest term we&apos;ve had.&rdquo;
          </blockquote>
          <figcaption className="mt-6 flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${GOLD} 0%, #8a6d1a 100%)` }}
              aria-hidden
            >
              PA
            </div>
            <div>
              <div className="font-semibold text-sm" style={{ color: NAVY }}>Principal Adeyemi</div>
              <div className="text-xs text-black/50">Head of School (pilot participant)</div>
            </div>
          </figcaption>
        </figure>
      </section>

      {/* ============================== CTA FOOTER ======================= */}
      <section className="relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div
            className="rounded-3xl px-8 md:px-14 py-14 md:py-16 text-white text-center relative overflow-hidden"
            style={{
              background: `linear-gradient(135deg, ${NAVY} 0%, #1B3E63 100%)`,
              boxShadow: "0 30px 60px -30px rgba(15,42,71,0.6)",
            }}
          >
            <div aria-hidden className="absolute inset-0 opacity-30" style={{
              backgroundImage: `radial-gradient(400px 200px at 20% 20%, rgba(201,162,39,0.35), transparent), radial-gradient(400px 200px at 80% 80%, rgba(201,162,39,0.2), transparent)`,
            }} />
            <div className="relative">
              <h2 className="text-3xl md:text-4xl max-w-2xl mx-auto" style={{ fontFamily: HEADING_FONT, fontWeight: 700 }}>
                Ready to see what a calm term feels like?
              </h2>
              <p className="mt-4 text-white/70 max-w-lg mx-auto">
                Book a 30-minute demo. We&apos;ll walk your team through the modules and
                answer every question — no slides, just the product.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <a
                  href="mailto:hello@smartandthrive.example?subject=Book%20a%20demo%20-%20Smart%20%26%20Thrive%20O%2FS"
                  className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-transform hover:-translate-y-px"
                  style={{ backgroundColor: GOLD, color: NAVY }}
                >
                  Book a demo <ArrowRight size={15} />
                </a>
                <LandingSignInChip variant="dark" />
              </div>
            </div>
          </div>
        </div>

        <footer className="border-t border-black/5">
          <div className="max-w-6xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-3 text-xs text-black/50">
            <div>
              &copy; {new Date().getFullYear()} Smart &amp; Thrive O/S. All rights reserved.
            </div>
            <div className="flex items-center gap-5">
              <a href="mailto:hello@smartandthrive.example" className="hover:text-black/80">hello@smartandthrive.example</a>
              <a href="/s/grant-schools" className="hover:text-black/80">See it live</a>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HeroIllustration — inline SVG, no external assets                  */
/* ------------------------------------------------------------------ */
function HeroIllustration() {
  return (
    <div className="relative">
      <div
        className="absolute -inset-6 rounded-3xl -z-10"
        style={{
          background: `linear-gradient(135deg, rgba(201,162,39,0.18) 0%, rgba(15,42,71,0.08) 100%)`,
          filter: "blur(24px)",
        }}
        aria-hidden
      />
      <div
        className="rounded-2xl overflow-hidden border border-black/[0.08]"
        style={{ backgroundColor: "white", boxShadow: "0 30px 60px -30px rgba(15,42,71,0.35)" }}
      >
        <svg
          viewBox="0 0 640 440"
          className="w-full h-auto"
          role="img"
          aria-label="Smart & Thrive O/S dashboard preview"
        >
          <defs>
            <linearGradient id="hero-bg" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#F7F5F0" />
              <stop offset="100%" stopColor="#FBF6E8" />
            </linearGradient>
            <linearGradient id="hero-gold" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#C9A227" />
              <stop offset="100%" stopColor="#8a6d1a" />
            </linearGradient>
            <linearGradient id="hero-navy" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#0F2A47" />
              <stop offset="100%" stopColor="#1B3E63" />
            </linearGradient>
          </defs>
          <rect width="640" height="440" fill="url(#hero-bg)" />
          {/* Sidebar */}
          <rect x="0" y="0" width="140" height="440" fill="url(#hero-navy)" />
          <circle cx="26" cy="30" r="10" fill="url(#hero-gold)" />
          <rect x="42" y="24" width="70" height="6" rx="3" fill="rgba(255,255,255,0.85)" />
          <rect x="42" y="34" width="40" height="4" rx="2" fill="rgba(255,255,255,0.35)" />
          {[70, 100, 130, 160, 190, 220, 250].map((y, i) => (
            <g key={y}>
              <rect x="16" y={y} width="14" height="14" rx="3" fill={i === 1 ? "url(#hero-gold)" : "rgba(255,255,255,0.15)"} />
              <rect x="36" y={y + 4} width={70 - (i % 3) * 10} height="6" rx="3" fill="rgba(255,255,255,0.65)" />
            </g>
          ))}
          {/* Header */}
          <rect x="160" y="20" width="180" height="10" rx="5" fill="#0F2A47" />
          <rect x="160" y="36" width="120" height="6" rx="3" fill="rgba(15,42,71,0.35)" />
          <rect x="500" y="20" width="120" height="26" rx="13" fill="url(#hero-gold)" />
          <rect x="516" y="30" width="90" height="6" rx="3" fill="rgba(255,255,255,0.9)" />
          {/* Stat tiles */}
          {[
            { x: 160, label: "Fees collected", val: "$42,180" },
            { x: 320, label: "Attendance", val: "94%" },
            { x: 480, label: "Reports ready", val: "128" },
          ].map((t, i) => (
            <g key={t.x}>
              <rect x={t.x} y="70" width="140" height="80" rx="10" fill="white" stroke="rgba(15,42,71,0.08)" />
              <rect x={t.x + 14} y="86" width="70" height="6" rx="3" fill="rgba(15,42,71,0.35)" />
              <rect x={t.x + 14} y="102" width="90" height="16" rx="4" fill="#0F2A47" />
              <rect x={t.x + 14} y="128" width={40 + i * 10} height="6" rx="3" fill={i === 1 ? "url(#hero-gold)" : "rgba(15,42,71,0.15)"} />
            </g>
          ))}
          {/* Chart area */}
          <rect x="160" y="170" width="300" height="240" rx="12" fill="white" stroke="rgba(15,42,71,0.08)" />
          <rect x="176" y="186" width="120" height="8" rx="4" fill="#0F2A47" />
          <rect x="176" y="200" width="80" height="5" rx="2.5" fill="rgba(15,42,71,0.35)" />
          <polyline
            points="176,360 216,320 256,340 296,290 336,300 376,250 416,270 446,230"
            fill="none"
            stroke="url(#hero-gold)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="176,380 216,360 256,370 296,340 336,350 376,320 416,340 446,300"
            fill="none"
            stroke="rgba(15,42,71,0.35)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="4 4"
          />
          {[176, 216, 256, 296, 336, 376, 416, 446].map((x) => (
            <circle key={x} cx={x} cy={x === 446 ? 230 : 260 + ((x / 40) % 3) * 10} r="3" fill="#0F2A47" opacity="0" />
          ))}
          {/* Right rail cards */}
          {[170, 250, 330].map((y, i) => (
            <g key={y}>
              <rect x="480" y={y} width="140" height="70" rx="10" fill="white" stroke="rgba(15,42,71,0.08)" />
              <circle cx="500" cy={y + 24} r="10" fill={i === 0 ? "url(#hero-gold)" : "rgba(15,42,71,0.15)"} />
              <rect x="518" y={y + 18} width="80" height="7" rx="3" fill="#0F2A47" />
              <rect x="518" y={y + 30} width="60" height="5" rx="2.5" fill="rgba(15,42,71,0.35)" />
              <rect x="494" y={y + 46} width="110" height="6" rx="3" fill="rgba(15,42,71,0.12)" />
              <rect x="494" y={y + 46} width={40 + i * 25} height="6" rx="3" fill="url(#hero-gold)" />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
