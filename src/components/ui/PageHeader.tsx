import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, children, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6", className)}>
      <div>
        <h1 className="text-2xl font-bold text-[#0F2A47]">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}

export function KpiCard({
  label, value, icon, sub, colorClass = "text-[#0F2A47]",
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  sub?: string;
  colorClass?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</span>
        {icon && <span className="text-gray-400">{icon}</span>}
      </div>
      <div className={cn("text-2xl font-bold", colorClass)}>{value}</div>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export function EmptyState({ message = "No records found.", icon }: { message?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-3 text-gray-300">{icon}</div>}
      <p className="text-gray-400 text-sm">{message}</p>
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
    success: "bg-green-600 text-white",
    error: "bg-red-600 text-white",
    info: "bg-[#0F2A47] text-white",
  };
  return (
    <div className={cn("fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-full text-sm font-medium shadow-lg", classes[type])}>
      {message}
    </div>
  );
}
