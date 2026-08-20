import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "green" | "amber" | "red" | "blue" | "purple" | "gray" | "navy";
  className?: string;
}

const variantClasses = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-blue-100 text-blue-800",
  purple: "bg-purple-100 text-purple-800",
  gray: "bg-gray-100 text-gray-700",
  navy: "bg-[#0F2A47] text-white",
};

export function Badge({ children, variant = "gray", className }: BadgeProps) {
  return (
    <span className={cn(
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold",
      variantClasses[variant],
      className
    )}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; variant: BadgeProps["variant"] }> = {
    paid: { label: "Paid in full", variant: "green" },
    partial: { label: "Part paid", variant: "amber" },
    unpaid: { label: "Unpaid", variant: "red" },
    active: { label: "Active", variant: "green" },
    inactive: { label: "Inactive", variant: "gray" },
    matched: { label: "Matched", variant: "green" },
    needs_review: { label: "Needs review", variant: "amber" },
    unmatched: { label: "Unmatched", variant: "gray" },
    duplicate: { label: "Duplicate", variant: "purple" },
    rejected: { label: "Rejected", variant: "red" },
    confirmed: { label: "Confirmed", variant: "green" },
    pending: { label: "Pending", variant: "blue" },
    parse_failed: { label: "Parse failed", variant: "red" },
    received: { label: "Received", variant: "blue" },
    admin: { label: "Admin", variant: "navy" },
    editor: { label: "Editor", variant: "blue" },
    viewer: { label: "Viewer", variant: "gray" },
    staff: { label: "Staff", variant: "blue" },
  };
  const cfg = configs[status] ?? { label: status, variant: "gray" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
