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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string; email: string; full_name?: string | null;
          role?: string; active?: boolean;
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
          created_at: string; updated_at: string;
        };
        Insert: {
          student_code: string; full_name: string; grade?: string | null;
          academic_year?: string | null; gender?: string | null;
          date_of_birth?: string | null; admission_date?: string | null;
          address?: string | null; guardian_name?: string | null;
          guardian_phone?: string | null; guardian_email?: string | null;
          status?: string; notes?: string | null;
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
    };
  };
};
