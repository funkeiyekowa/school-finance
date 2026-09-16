"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import type { StudentResults } from "@/lib/types/student-dashboard";

const EMPTY: StudentResults = {
  found: false,
  assessment_types: [],
  subjects: [],
  attempts: [],
  attendance: null,
};

export function useStudentResults() {
  const { user } = useAuth();
  const [data, setData] = useState<StudentResults>(EMPTY);
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
    const { data: payload, error: rpcError } = await supabase.rpc("get_student_results");
    if (rpcError) {
      setError(rpcError.message);
      setData(EMPTY);
      setLoading(false);
      return;
    }
    const raw = (Array.isArray(payload) ? payload[0] : payload) as StudentResults | null;
    setData(raw && raw.found ? { ...EMPTY, ...raw } : EMPTY);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...data, loading, error, reload };
}
