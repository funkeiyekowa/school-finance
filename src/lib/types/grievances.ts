/**
 * Grievances — shared shapes for the raiser view (`/dashboard/my-grievances`)
 * and the staff triage queue (`/dashboard/grievances`).
 *
 * Backed by `public.grievances` (supabase/grievances_module.sql). The
 * lifecycle is deliberately linear up to the point a member of staff picks
 * it up, then terminal in one of two ways:
 *
 *   draft -> submitted -> in_progress -> resolved | rejected
 *
 * A raiser may edit only while it is a `draft`; once submitted it is the
 * school's record. RLS enforces that, not just the UI.
 */

export type GrievanceStatus =
  | "draft"
  | "submitted"
  | "in_progress"
  | "resolved"
  | "rejected";

export type GrievanceCategory = "academic" | "non_academic";
export type GrievancePriority = "low" | "normal" | "high";

export interface Grievance {
  id: string;
  organization_id: string;
  reference: string | null;
  raised_by: string;
  student_id: string | null;
  subject: string;
  description: string | null;
  category: GrievanceCategory;
  subcategory: string | null;
  status: GrievanceStatus;
  priority: GrievancePriority;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Badge variant + label per status, so both screens read identically. */
export const GRIEVANCE_STATUS_META: Record<
  GrievanceStatus,
  { label: string; variant: "gray" | "blue" | "amber" | "green" | "red" }
> = {
  draft: { label: "Draft", variant: "gray" },
  submitted: { label: "Submitted", variant: "blue" },
  in_progress: { label: "In progress", variant: "amber" },
  resolved: { label: "Resolved", variant: "green" },
  rejected: { label: "Rejected", variant: "red" },
};

export const GRIEVANCE_CATEGORY_LABELS: Record<GrievanceCategory, string> = {
  academic: "Academic",
  non_academic: "Non-Academic",
};

/**
 * Suggested sub-categories per top-level category. Free text is still
 * allowed on the record — these only populate the picker, so a school is
 * never boxed in by a list we guessed at.
 */
export const GRIEVANCE_SUBCATEGORIES: Record<GrievanceCategory, string[]> = {
  academic: [
    "Grades Issues",
    "Teaching Quality",
    "Examination / CBT",
    "Timetable Clash",
    "Course Materials",
  ],
  non_academic: [
    "Transport Facility",
    "Hostel / Boarding",
    "Health & Clinic",
    "Fees & Billing",
    "Facilities & Maintenance",
    "Bullying / Welfare",
  ],
};

export const GRIEVANCE_PRIORITY_LABELS: Record<GrievancePriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

/** Statuses a grievance is still actively being worked in. */
export const OPEN_GRIEVANCE_STATUSES: GrievanceStatus[] = [
  "submitted",
  "in_progress",
];
