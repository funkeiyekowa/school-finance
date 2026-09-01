import { cn } from "@/lib/utils";
import { Sparkline } from "./Sparkline";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

/**
 * Bold, premium page header with optional icon medallion, breadcrumb,
 * and eyebrow chip. Backwards compatible with the previous API — just
 * pass title + subtitle if that's all you need.
 */
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;                              // small tag above the title, e.g. "OPERATIONS"
  icon?: React.ReactNode;                        // renders as a gradient medallion at the left
  gradient?: "navy" | "gold" | "emerald" | "purple" | "rose" | "amber" | "none";
  breadcrumb?: { label: string; href?: string }[];
  children?: React.ReactNode;
  className?: string;
}

const gradients: Record<NonNullable<PageHeaderProps["gradient"]>, string> = {
  navy:    "from-[#0F2A47] to-[#1B3E63]",
  gold:    "from-[#C9A227] to-[#e6bf39]",
  emerald: "from-emerald-600 to-emerald-500",
  purple:  "from-purple-600 to-fuchsia-500",
  rose:    "from-rose-600 to-pink-500",
  amber:   "from-amber-500 to-orange-500",
  none:    "",
};

export function PageHeader({
  title, subtitle, eyebrow, icon, gradient = "navy", breadcrumb, children, className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-6", className)}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
          {breadcrumb.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-gray-300">/</span>}
              {c.href ? <a href={c.href} className="hover:text-[#0F2A47] transition-colors">{c.label}</a> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          {icon && (
            <div className={cn(
              "shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-white bg-gradient-to-br shadow-md",
              gradients[gradient]
            )}>
              {icon}
            </div>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <span className="inline-block text-[10px] font-bold uppercase tracking-widest text-[#C9A227] mb-1">{eyebrow}</span>
            )}
            <h1 className="text-2xl md:text-3xl font-bold text-[#0F2A47] leading-tight truncate">{title}</h1>
            {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
          </div>
        </div>
        {children && <div className="flex items-center gap-2 shrink-0 flex-wrap">{children}</div>}
      </div>
    </div>
  );
}

/**
 * KpiCard — premium, bold. Optional trend arrow (`trend`) shows a
 * pct-change chip; `sparkline` (a numeric series) draws a 7-day
 * inline chart. `accent` paints a coloured left rail. If you only
 * pass label + value it renders the previous flat card, no regressions.
 */
export function KpiCard({
  label, value, icon, sub, colorClass = "text-[#0F2A47]",
  trend, sparkline, accent, sparklineTone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  sub?: string;
  colorClass?: string;
  trend?: { pct: number; positiveIsGood?: boolean };
  sparkline?: number[];
  sparklineTone?: "navy" | "gold" | "emerald" | "red" | "amber";
  accent?: "navy" | "gold" | "emerald" | "red" | "amber" | "purple";
}) {
  const accentBar: Record<NonNullable<typeof accent>, string> = {
    navy: "bg-[#0F2A47]", gold: "bg-[#C9A227]", emerald: "bg-emerald-500",
    red: "bg-red-500", amber: "bg-amber-500", purple: "bg-purple-500",
  };
  const trendColor = trend
    ? (trend.pct >= 0 ? (trend.positiveIsGood === false ? "text-red-600" : "text-emerald-600")
                     : (trend.positiveIsGood === false ? "text-emerald-600" : "text-red-600"))
    : "";
  return (
    <div className="relative bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-5 overflow-hidden">
      {accent && <div className={cn("absolute left-0 top-0 bottom-0 w-1", accentBar[accent])} />}
      <div className="flex items-start justify-between mb-3">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">{label}</span>
        {icon && <span className="text-gray-400 shrink-0">{icon}</span>}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className={cn("text-2xl md:text-3xl font-bold leading-none", colorClass)}>{value}</div>
          {sub && <p className="text-xs text-gray-400 mt-1.5">{sub}</p>}
          {trend && (
            <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-bold mt-1.5", trendColor)}>
              {trend.pct >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {Math.abs(trend.pct).toFixed(1)}%
            </span>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <Sparkline data={sparkline} tone={sparklineTone ?? "navy"} width={80} height={32} />
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  message = "No records found.",
  icon,
  action,
}: {
  message?: string;
  icon?: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-3 text-gray-300">{icon}</div>}
      <p className="text-gray-400 text-sm">{message}</p>
      {action && (
        <button onClick={action.onClick} className="mt-4 text-sm font-semibold text-[#C9A227] hover:text-[#b8911e]">
          {action.label} →
        </button>
      )}
    </div>
  );
}

export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-[#F4E9C7] border-t-[#C9A227] rounded-full animate-spin" />
    </div>
  );
}

export function Toast({ message, type = "success" }: { message: string; type?: "success" | "error" | "info" }) {
  const classes = {
    success: "bg-emerald-600 text-white",
    error: "bg-red-600 text-white",
    info: "bg-[#0F2A47] text-white",
  };
  return (
    <div className={cn("fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-full text-sm font-medium shadow-lg", classes[type])}>
      {message}
    </div>
  );
}

/** SectionHeading — for grouping content within a page. Bold. */
export function SectionHeading({
  title, subtitle, icon, action, className,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 mb-3", className)}>
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-[#C9A227] shrink-0">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-[#0F2A47] uppercase tracking-wider truncate">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
