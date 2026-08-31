import { useState, useCallback, useEffect, useMemo } from "react";
import { SupabaseClient } from "@supabase/supabase-js";

export interface PaginationState {
  offset: number;
  limit: number;
  total: number;
  hasNext: boolean;
  hasPrev: boolean;
  pageCount: number;
  currentPage: number;
}

export interface UsePaginatedDataOptions {
  limit?: number;
  rpcName: string;
  supabase: SupabaseClient;
}

/**
 * Hook for paginated data fetching via Supabase RPC
 * Manages offset-based pagination state and data loading
 */
export function usePaginatedData<T extends { total_count?: number }>(
  rpcParams: Record<string, unknown>,
  options: UsePaginatedDataOptions
) {
  const { limit = 50, rpcName, supabase } = options;

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const pagination: PaginationState = useMemo(
    () => ({
      offset,
      limit,
      total,
      hasNext: offset + limit < total,
      hasPrev: offset > 0,
      pageCount: Math.ceil(total / limit),
      currentPage: Math.floor(offset / limit) + 1,
    }),
    [offset, limit, total]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: result, error: err } = await supabase.rpc(rpcName, {
        p_offset: offset,
        p_limit: limit,
        ...rpcParams,
      });

      if (err) throw err;

      const rows = (result ?? []) as T[];
      setData(rows);
      if (rows.length > 0 && rows[0].total_count !== undefined) {
        setTotal((rows[0].total_count as number) || 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [offset, limit, rpcName, rpcParams, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    data,
    loading,
    error,
    pagination,
    refetch: load,
    nextPage: () => {
      if (pagination.hasNext) setOffset(offset + limit);
    },
    prevPage: () => {
      if (pagination.hasPrev) setOffset(Math.max(0, offset - limit));
    },
    goToPage: (page: number) => {
      const newOffset = Math.max(0, (page - 1) * limit);
      setOffset(newOffset);
    },
    reset: () => setOffset(0),
  };
}
