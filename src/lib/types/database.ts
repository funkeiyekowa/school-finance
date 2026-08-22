export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// Using Record<string, unknown> for Update types to allow flexible partial updates
// while avoiding TypeScript `never` inference issues with Supabase's generic client

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          role: string;
          active: boolean;
          organization_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string; email: string; full_name?: string | null;
          role?: string; active?: boolean; organization_id?: string | null;
        };
        Update: Record<string, unknown>;
      };
      students: {
        Row: {
          id: string; student_code: string; full_name: string;
          grade: string | null; academic_year: string | null;
          gender: string | null; date_of_birth: string | null;
          admission_date: string | null; address: string | null;
          guardian_name: string | null; guardian_phone: string | null;
          guardian_email: string | null; status: string; notes: string | null;
          organization_id: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          student_code: string; full_name: string; grade?: string | null;
          academic_year?: string | null; gender?: string | null;
          date_of_birth?: string | null; admission_date?: string | null;
          address?: string | null; guardian_name?: string | null;
          guardian_phone?: string | null; guardian_email?: string | null;
          status?: string; notes?: string | null; organization_id?: string | null;
        };
        Update: Record<string, unknown>;
      };
      vendors: {
        Row: {
          id: string; vendor_code: string; name: string;
          category: string | null; contact_person: string | null;
          phone: string | null; email: string | null;
          address: string | null; notes: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          vendor_code: string; name: string; category?: string | null;
          contact_person?: string | null; phone?: string | null;
          email?: string | null; address?: string | null; notes?: string | null;
        };
        Update: Record<string, unknown>;
      };
      income_entries: {
        Row: {
          id: string; receipt_no: string; date: string;
          student_id: string | null; student_name: string | null;
          category: string; description: string | null;
          amount: number; payment_method: string;
          term: string | null; recorded_by: string | null;
          reconciled: boolean; payment_source: string;
          sms_inbox_id: string | null; notes: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          receipt_no: string; date: string;
          student_id?: string | null; student_name?: string | null;
          category: string; description?: string | null;
          amount: number; payment_method: string;
          term?: string | null; recorded_by?: string | null;
          reconciled?: boolean; payment_source?: string;
          sms_inbox_id?: string | null; notes?: string | null;
        };
        Update: Record<string, unknown>;
      };
      expense_entries: {
        Row: {
          id: string; voucher_no: string; date: string;
          vendor_id: string | null; vendor_name: string | null;
          category: string; description: string | null;
          amount: number; payment_method: string;
          approved_by: string | null; reconciled: boolean;
          notes: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          voucher_no: string; date: string;
          vendor_id?: string | null; vendor_name?: string | null;
          category: string; description?: string | null;
          amount: number; payment_method: string;
          approved_by?: string | null; reconciled?: boolean;
          notes?: string | null;
        };
        Update: Record<string, unknown>;
      };
      fee_schedules: {
        Row: {
          id: string; name: string; amount: number; category: string;
          grade: string | null; term: string | null;
          academic_year: string | null; active: boolean;
          description: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          name: string; amount: number; category: string;
          grade?: string | null; term?: string | null;
          academic_year?: string | null; active?: boolean;
          description?: string | null;
        };
        Update: Record<string, unknown>;
      };
      bank_transactions: {
        Row: {
          id: string; date: string; description: string;
          amount: number; direction: string;
          reference: string | null; sender_name: string | null;
          bank_transaction_id: string | null;
          match_status: string;
          matched_income_id: string | null; matched_expense_id: string | null;
          confidence: number | null; source: string;
          raw_payload: Json | null; created_at: string; updated_at: string;
        };
        Insert: {
          date: string; description: string; amount: number;
          direction?: string; reference?: string | null;
          sender_name?: string | null; bank_transaction_id?: string | null;
          match_status?: string; matched_income_id?: string | null;
          matched_expense_id?: string | null; confidence?: number | null;
          source?: string; raw_payload?: Json | null;
        };
        Update: Record<string, unknown>;
      };
      sms_inbox: {
        Row: {
          id: string; event_id: string | null; message_id: string | null;
          device_id: string | null; sender: string | null;
          recipient: string | null; sim_number: number | null;
          message_text: string; received_at: string | null;
          parsed_student_number: string | null; parsed_student_name: string | null;
          parsed_amount: number | null; parsed_currency: string;
          parsed_reference: string | null; parser_version: string | null;
          processing_status: string; match_status: string;
          match_reason: string | null; matched_student_id: string | null;
          matched_fee_id: string | null; confidence_score: number | null;
          raw_payload: Json | null;
          review_notes?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          /** "sms" or "email" — which channel this alert arrived on. */
          source_channel?: string;
          /** Email subject line, when source_channel is "email". */
          email_subject?: string | null;
          /** Archive lifecycle: ACTIVE, PLATFORM_DUPLICATE, POSSIBLE_DUPLICATE, MANUALLY_ARCHIVED */
          archive_status?: string;
          /** FK to the primary alert when this is a duplicate. */
          primary_alert_id?: string | null;
          /** When the record was archived. */
          archived_at?: string | null;
          /** Who archived it (null = system). */
          archived_by?: string | null;
          /** Human-readable archive reason. */
          archive_reason?: string | null;
          /** Duplicate detection confidence score (0-100). */
          duplicate_confidence?: number | null;
          /** Structured evidence JSON. */
          duplicate_evidence?: unknown;
          created_at: string; updated_at: string;
        };
        Insert: {
          event_id?: string | null; message_id?: string | null;
          device_id?: string | null; sender?: string | null;
          recipient?: string | null; sim_number?: number | null;
          message_text: string; received_at?: string | null;
          parsed_student_number?: string | null; parsed_student_name?: string | null;
          parsed_amount?: number | null; parsed_currency?: string;
          parsed_reference?: string | null; parser_version?: string | null;
          processing_status?: string; match_status?: string;
          match_reason?: string | null; matched_student_id?: string | null;
          matched_fee_id?: string | null; confidence_score?: number | null;
          raw_payload?: Json | null;
          source_channel?: string;
          email_subject?: string | null;
          archive_status?: string;
          primary_alert_id?: string | null;
          archived_at?: string | null;
          archived_by?: string | null;
          archive_reason?: string | null;
          duplicate_confidence?: number | null;
          duplicate_evidence?: unknown;
        };
        Update: Record<string, unknown>;
      };
      activity_log: {
        Row: {
          id: string; timestamp: string;
          user_email: string | null; user_name: string | null;
          action: string; details: string | null; created_at: string;
        };
        Insert: {
          timestamp?: string;
          user_email?: string | null; user_name?: string | null;
          action: string; details?: string | null;
        };
        Update: Record<string, unknown>;
      };
      school_settings: {
        Row: {
          id: string; school_name: string; address: string | null;
          phone: string | null; email: string | null; logo_url: string | null;
          currency_symbol: string; currency_code: string;
          receipt_prefix: string; voucher_prefix: string;
          receipt_footer: string | null; current_term: string | null;
          current_year: string | null; updated_at: string;
        };
        Insert: {
          id?: string; school_name: string; address?: string | null;
          phone?: string | null; email?: string | null; logo_url?: string | null;
          currency_symbol?: string; currency_code?: string;
          receipt_prefix?: string; voucher_prefix?: string;
          receipt_footer?: string | null; current_term?: string | null;
          current_year?: string | null;
        };
        Update: Record<string, unknown>;
      };
      roles: {
        Row: {
          id: string; name: string; description: string | null;
          is_default: boolean; permissions: Json;
          created_at: string; updated_at: string;
        };
        Insert: {
          name: string; description?: string | null;
          is_default?: boolean; permissions?: Json;
        };
        Update: Record<string, unknown>;
      };
      classes: {
        Row: {
          id: string; name: string; short_code: string;
          sequence: number; stage: string | null;
          next_class_id: string | null; is_terminal: boolean;
          active: boolean; created_at: string; updated_at: string;
        };
        Insert: {
          name: string; short_code: string; sequence?: number;
          stage?: string | null; next_class_id?: string | null;
          is_terminal?: boolean; active?: boolean;
        };
        Update: Record<string, unknown>;
      };
      academic_years: {
        Row: {
          id: string; name: string; start_date: string | null;
          end_date: string | null; status: string;
          created_at: string; updated_at: string;
        };
        Insert: {
          name: string; start_date?: string | null;
          end_date?: string | null; status?: string;
        };
        Update: Record<string, unknown>;
      };
      student_enrollments: {
        Row: {
          id: string; student_id: string; class_id: string;
          academic_year_id: string; status: string;
          enrolled_at: string; promoted_from_id: string | null;
          notes: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          student_id: string; class_id: string; academic_year_id: string;
          status?: string; enrolled_at?: string;
          promoted_from_id?: string | null; notes?: string | null;
        };
        Update: Record<string, unknown>;
      };
      promotion_batches: {
        Row: {
          id: string; batch_code: string;
          from_year_id: string; to_year_id: string;
          status: string; total_students: number;
          promoted: number; repeated: number;
          graduated: number; excluded: number; failed: number;
          created_by_email: string | null; created_by_name: string | null;
          reversed_at: string | null; reversed_by: string | null;
          reversal_reason: string | null; notes: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          batch_code: string; from_year_id: string; to_year_id: string;
          status?: string; total_students?: number;
          promoted?: number; repeated?: number;
          graduated?: number; excluded?: number; failed?: number;
          created_by_email?: string | null; created_by_name?: string | null;
          notes?: string | null;
        };
        Update: Record<string, unknown>;
      };
      promotion_events: {
        Row: {
          id: string; batch_id: string | null; student_id: string;
          from_enrollment_id: string | null; to_enrollment_id: string | null;
          from_class_id: string | null; to_class_id: string | null;
          from_year_id: string | null; to_year_id: string | null;
          action: string; reason: string | null; status: string;
          created_by_email: string | null; created_by_name: string | null;
          created_at: string;
        };
        Insert: {
          batch_id?: string | null; student_id: string;
          from_enrollment_id?: string | null; to_enrollment_id?: string | null;
          from_class_id?: string | null; to_class_id?: string | null;
          from_year_id?: string | null; to_year_id?: string | null;
          action: string; reason?: string | null; status?: string;
          created_by_email?: string | null; created_by_name?: string | null;
        };
        Update: Record<string, unknown>;
      };
      // --- Attendance & Subjects tables ---
      subjects: {
        Row: {
          id: string; name: string; short_code: string;
          department: string | null; class_id: string | null;
          is_elective: boolean; active: boolean;
          organization_id: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          name: string; short_code: string;
          department?: string | null; class_id?: string | null;
          is_elective?: boolean; active?: boolean;
          organization_id?: string | null;
        };
        Update: Record<string, unknown>;
      };
      attendance_statuses: {
        Row: {
          id: string; code: string; label: string;
          color: string; counts_as_present: boolean;
          is_default: boolean; sort_order: number;
          active: boolean; organization_id: string | null;
          created_at: string;
        };
        Insert: {
          code: string; label: string;
          color?: string; counts_as_present?: boolean;
          is_default?: boolean; sort_order?: number;
          active?: boolean; organization_id?: string | null;
        };
        Update: Record<string, unknown>;
      };
      attendance_records: {
        Row: {
          id: string; student_id: string; class_id: string | null;
          academic_year_id: string | null; subject_id: string | null;
          date: string; status_code: string; session: string;
          remarks: string | null; recorded_by: string | null;
          organization_id: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          student_id: string; date: string;
          class_id?: string | null; academic_year_id?: string | null;
          subject_id?: string | null; status_code?: string;
          session?: string; remarks?: string | null;
          recorded_by?: string | null; organization_id?: string | null;
        };
        Update: Record<string, unknown>;
      };
      periods: {
        Row: {
          id: string; name: string; short_code: string;
          start_time: string; end_time: string;
          is_break: boolean; sort_order: number; active: boolean;
          organization_id: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          name: string; short_code: string;
          start_time: string; end_time: string;
          is_break?: boolean; sort_order?: number; active?: boolean;
          organization_id?: string | null;
        };
        Update: Record<string, unknown>;
      };
      timetable_entries: {
        Row: {
          id: string; class_id: string; subject_id: string;
          period_id: string; teacher_name: string | null;
          day_of_week: number; room: string | null;
          academic_year_id: string | null; notes: string | null;
          organization_id: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          class_id: string; subject_id: string; period_id: string;
          day_of_week: number; teacher_name?: string | null;
          room?: string | null; academic_year_id?: string | null;
          notes?: string | null; organization_id?: string | null;
        };
        Update: Record<string, unknown>;
      };
      // --- Multi-tenant tables ---
      organizations: {
        Row: {
          id: string; name: string; slug: string;
          logo_url: string | null; email: string | null;
          phone: string | null; address: string | null;
          country: string | null; timezone: string;
          currency_code: string; currency_symbol: string;
          status: string; plan: string;
          settings: Json; created_at: string; updated_at: string;
        };
        Insert: {
          name: string; slug: string;
          logo_url?: string | null; email?: string | null;
          phone?: string | null; address?: string | null;
          country?: string | null; timezone?: string;
          currency_code?: string; currency_symbol?: string;
          status?: string; plan?: string; settings?: Json;
        };
        Update: Record<string, unknown>;
      };
      platform_modules: {
        Row: {
          id: string; key: string; name: string;
          description: string | null; category: string | null;
          is_core: boolean; sort_order: number; created_at: string;
        };
        Insert: {
          key: string; name: string;
          description?: string | null; category?: string | null;
          is_core?: boolean; sort_order?: number;
        };
        Update: Record<string, unknown>;
      };
      subscriptions: {
        Row: {
          id: string; organization_id: string; module_key: string;
          status: string; starts_at: string;
          expires_at: string | null; limits: Json;
          created_at: string;
        };
        Insert: {
          organization_id: string; module_key: string;
          status?: string; starts_at?: string;
          expires_at?: string | null; limits?: Json;
        };
        Update: Record<string, unknown>;
      };
      org_memberships: {
        Row: {
          id: string; user_id: string; organization_id: string;
          role: string; is_default: boolean; active: boolean;
          joined_at: string;
        };
        Insert: {
          user_id: string; organization_id: string;
          role?: string; is_default?: boolean; active?: boolean;
        };
        Update: Record<string, unknown>;
      };
    };
  };
};
