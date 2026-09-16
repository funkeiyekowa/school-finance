"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import type { StudentDashboard } from "@/lib/types/student-dashboard";

const EMPTY: StudentDashboard = {
  found: false,
  student: null,
  exams: [],
  report_cards: [],
  stats: { available: 0, in_progress: 0, upcoming: 0, completed: 0, avg_percentage: null },
};

/**
 * Single source of truth for the student dashboard.
 * All exam-visibility, attempt-state and averaging rules live in
 * public.get_student_dashboard(); this hook only transports them.
 * Errors are surfaced, never swallowed into an empty state.
 */
export function useStudentDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<StudentDashboard>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data: payload, error: rpcError } = await supabase.rpc("get_student_dashboard");
    if (rpcError) {
      setError(rpcError.message);
      setData(EMPTY);
      setLoading(false);
      return;
    }
    const raw = (Array.isArray(payload) ? payload[0] : payload) as StudentDashboard | null;
    setData(raw && raw.found ? { ...EMPTY, ...raw } : EMPTY);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...data, loading, error, reload };
}
