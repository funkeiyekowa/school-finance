export interface ClassRow {
  id: string;
  name: string;
  short_code: string | null;
  sequence: number | null;
  organization_id: string;
}

export interface SubjectRow {
  id: string;
  name: string;
  short_code: string | null;
}

export interface StatusRow {
  code: string;
  label: string;
  is_default: boolean | null;
  sort_order: number | null;
}

export interface StudentRow {
  id: string;
  student_code: string | null;
  full_name: string;
  grade: string | null;
}

export interface AttendanceRecordRow {
  id: string;
  student_id: string;
  status_code: string;
  remarks: string | null;
}

/**
 * Mirror of the org-level flags returned by get_my_attendance_capture_settings().
 * Phase 8.1/8.2 config controls — the mobile capture screen honours the same
 * flags the web capture page does, so a school that disables subject-level
 * attendance (or period selection) sees the same thing on both surfaces.
 */
export interface CaptureConfig {
  enabled_capture_methods: string[];
  subject_attendance_enabled: boolean;
  period_selection_enabled: boolean;
  class_level_attendance_enabled: boolean;
  subject_required_for_attendance: boolean;
  manual_session_enabled: boolean;
  default_session: string;
  default_attendance_mode: string;
}

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  enabled_capture_methods: ["manual"],
  subject_attendance_enabled: true,
  period_selection_enabled: true,
  class_level_attendance_enabled: true,
  subject_required_for_attendance: false,
  manual_session_enabled: true,
  default_session: "full_day",
  default_attendance_mode: "class",
};

export const SESSIONS: { value: string; label: string }[] = [
  { value: "full_day", label: "Full day" },
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
];

/** Roles permitted to capture attendance on mobile. */
export type CaptureRole = "teacher" | "admin" | "staff";

export function canCaptureAttendance(role: string): role is CaptureRole {
  return role === "teacher" || role === "admin" || role === "staff";
}
