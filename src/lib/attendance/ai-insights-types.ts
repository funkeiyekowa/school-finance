export interface InsightsRequest {
  scope: "class" | "student" | "school";
  class_id?: string;
  student_id?: string;
  date_from: string;
  date_to: string;
  capability: "patterns" | "anomaly" | "summary" | "warnings" | "data_quality" | "all";
}

export interface AiPayloadStudentStat {
  ref: string;
  absence_rate_pct: number;
  consecutive_absences: number;
  sessions_absent: string[];
  day_of_week_pattern: Record<string, number>;
}

export interface AiPayloadClassStat {
  ref: string;
  avg_attendance_rate_pct: number;
  school_avg_delta: number;
  lowest_day: string;
  lowest_rate: number;
}

export interface AiPayloadRecordingStat {
  ref: string;
  dates_with_no_record: string[];
  dates_with_partial_record: string[];
  unusual_bulk_changes: string[];
}

export interface AiPayload {
  context: {
    date_from: string;
    date_to: string;
    school_avg_attendance_rate: number;
    total_students_in_scope: number;
    total_classes_in_scope: number;
  };
  student_stats: AiPayloadStudentStat[];
  class_stats: AiPayloadClassStat[];
  recording_stats: AiPayloadRecordingStat[];
  capabilities_requested: string[];
}

export type FindingType = "fact" | "pattern" | "suggestion" | "data_quality_issue";
export type FindingSeverity = "info" | "warning" | "alert";
export type FindingScope = "student" | "class" | "school" | "recording";

export interface Finding {
  type: FindingType;
  severity: FindingSeverity;
  scope: FindingScope;
  ref: string;
  title: string;
  detail: string;
  suggested_action?: string;
  display_name?: string;
}

export interface AttendanceInsightsResponse {
  generated_at: string;
  summary: string;
  findings: Finding[];
}
