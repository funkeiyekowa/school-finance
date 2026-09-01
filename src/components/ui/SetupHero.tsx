"use client";

import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { Button } from "./Button";

/**
 * In-page onboarding hero for empty modules. Replaces the generic
 * "No records found" EmptyState with a friendly welcome screen that
 * explains what the module does, lists what the user can do here,
 * and gives one big CTA that opens the primary create form.
 *
 * Bold & modern: gradient background, big icon medallion, subtle
 * grain, animated shine on the CTA. Every dashboard tab in this
 * codebase now uses this on first visit.
 */
interface SetupHeroProps {
  icon: React.ReactNode;                     // primary lucide icon (36-40px)
  title: string;
  description: string;                        // one-sentence value prop
  bullets?: string[];                          // 2-4 short benefits
  primaryCta: { label: string; onClick: () => void; disabled?: boolean };
  secondaryCta?: { label: string; onClick: () => void };
  tone?: "navy" | "gold" | "emerald" | "purple" | "rose" | "amber";
  className?: string;
}

const toneClasses: Record<NonNullable<SetupHeroProps["tone"]>, { grad: string; ring: string; text: string }> = {
  navy:    { grad: "from-[#0F2A47] via-[#1B3E63] to-[#0F2A47]", ring: "ring-[#F4E9C7]", text: "text-[#F4E9C7]" },
  gold:    { grad: "from-[#C9A227] via-[#e6bf39] to-[#C9A227]", ring: "ring-white/30", text: "text-white" },
  emerald: { grad: "from-emerald-600 via-emerald-500 to-emerald-700", ring: "ring-emerald-100", text: "text-emerald-50" },
  purple:  { grad: "from-purple-600 via-fuchsia-500 to-purple-700", ring: "ring-purple-100", text: "text-purple-50" },
  rose:    { grad: "from-rose-600 via-pink-500 to-rose-700", ring: "ring-rose-100", text: "text-rose-50" },
  amber:   { grad: "from-amber-500 via-orange-500 to-amber-600", ring: "ring-amber-100", text: "text-amber-50" },
};

export function SetupHero({
  icon, title, description, bullets, primaryCta, secondaryCta, tone = "navy", className,
}: SetupHeroProps) {
  const t = toneClasses[tone];
  return (
    <div className={cn(
      "relative overflow-hidden rounded-3xl bg-gradient-to-br shadow-lg",
      t.grad, className,
    )}>
      {/* Subtle geometric background pattern */}
      <div className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 80% 60%, white 1px, transparent 1px)",
          backgroundSize: "40px 40px, 60px 60px",
        }}
      />
      {/* Big medallion icon */}
      <div className="absolute -right-10 -top-10 w-64 h-64 rounded-full bg-white/10 blur-3xl pointer-events-none" />

      <div className="relative p-8 md:p-12 flex flex-col md:flex-row items-start gap-6">
        <div className={cn(
          "shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-white/15 backdrop-blur ring-4 flex items-center justify-center text-white",
          t.ring
        )}>
          {icon}
        </div>

        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className={t.text} />
            <span className={cn("text-xs font-bold uppercase tracking-widest", t.text)}>Get started</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-white leading-tight">{title}</h2>
          <p className="text-sm md:text-base text-white/80 max-w-2xl">{description}</p>

          {bullets && bullets.length > 0 && (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 pt-2">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm text-white/85">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-white/60 shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-3">
            <button
              onClick={primaryCta.onClick}
              disabled={primaryCta.disabled}
              className="group relative inline-flex items-center gap-2 bg-white text-[#0F2A47] font-bold px-6 py-3 rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:pointer-events-none overflow-hidden"
            >
              <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/60 to-transparent" />
              <span className="relative">{primaryCta.label} →</span>
            </button>
            {secondaryCta && (
              <Button variant="ghost" className="!text-white/80 hover:!bg-white/10" onClick={secondaryCta.onClick}>
                {secondaryCta.label}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
