import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, Mail, Sparkles } from "lucide-react";

export const metadata: Metadata = {
  title: "Request a demo | Smart & Thrive O/S",
  description: "Request a guided demo or start planning your Smart & Thrive O/S school setup.",
};

const CONTACT_EMAIL = "hello@smartandthrive.com";
const EMAIL_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Smart & Thrive O/S demo or onboarding request")}`;

const nextSteps = [
  "Tell us your school name and approximate student count.",
  "Share the modules you want to explore first.",
  "We will reply with a suitable demo or onboarding time.",
];

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-[#F8F5EC] px-5 py-8 text-[#0F2A47] sm:px-8 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#0F2A47] transition-colors hover:text-[#8A6D1A]"
        >
          <ArrowLeft size={16} /> Back to Smart & Thrive O/S
        </Link>

        <section className="mt-8 overflow-hidden rounded-[2rem] border border-[#C9A227]/25 bg-white shadow-[0_24px_80px_rgba(15,42,71,0.10)]">
          <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
            <div className="p-7 sm:p-10 lg:p-14">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#FBF6E8] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[#8A6D1A]">
                <Sparkles size={14} /> Demo & onboarding
              </div>

              <h1 className="mt-6 max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                Let&apos;s plan your school&apos;s next step.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
                Request a guided product tour or start a conversation about bringing your school onto Smart & Thrive O/S.
                No account or tenant is created automatically.
              </p>

              <a
                href={EMAIL_HREF}
                className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#0F2A47] px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-[#163B63]"
              >
                <Mail size={17} /> Email our team <ArrowRight size={16} />
              </a>
              <p className="mt-3 text-sm text-slate-500">
                Or write directly to <a className="font-semibold text-[#0F2A47] underline underline-offset-4" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </p>
            </div>

            <aside className="bg-[#0F2A47] p-7 text-white sm:p-10 lg:p-12">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#E5C85B]">What happens next</p>
              <h2 className="mt-3 text-2xl font-semibold">A simple, human handoff.</h2>
              <div className="mt-7 space-y-5">
                {nextSteps.map((step, index) => (
                  <div key={step} className="flex gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-[#E5C85B]">
                      {index + 1}
                    </span>
                    <p className="text-sm leading-6 text-slate-200">{step}</p>
                  </div>
                ))}
              </div>

              <div className="mt-9 rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <CheckCircle2 size={17} className="text-[#E5C85B]" /> No shared demo credentials
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-300">
                  Demo access is arranged privately, and starting free begins with a setup conversation—not automatic provisioning.
                </p>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
