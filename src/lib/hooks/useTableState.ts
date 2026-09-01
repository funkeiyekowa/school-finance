"use client";

import { useMemo, useState } from "react";

/**
 * useTableState — a tiny hook that unifies the search + sort + page
 * state duplicated across dashboard pages. Give it the rows and how
 * to search a row, get back the currently-visible slice plus the
 * setters/handlers for a search input, sort headers, and pagination.
 *
 *   const t = useTableState(rows, {
 *     searchable: (r) => `${r.name} ${r.code}`.toLowerCase(),
 *     pageSize: 25,
 *   });
 *   t.visible                — the current page's rows after search + sort
 *   t.setQuery(v), t.query
 *   t.toggleSort("name"), t.sortKey, t.sortDir
 *   t.page, t.setPage, t.pageCount, t.total
 */
export interface UseTableStateOptions<T> {
  searchable?: (row: T) => string;
  pageSize?: number;
  initialSort?: { key: keyof T | string; dir?: "asc" | "desc" };
}

export function useTableState<T>(rows: T[], opts: UseTableStateOptions<T> = {}) {
  const { searchable, pageSize = 25, initialSort } = opts;
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(initialSort?.key ? String(initialSort.key) : null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSort?.dir ?? "asc");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!query.trim() || !searchable) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((r) => searchable(r).toLowerCase().includes(q));
  }, [rows, query, searchable]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av < bv ? -1 : 1;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(page, pageCount - 1);
  const start = clampedPage * pageSize;
  const visible = sorted.slice(start, start + pageSize);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return {
    visible, filtered: sorted, total, pageCount,
    query, setQuery,
    sortKey, sortDir, toggleSort,
    page: clampedPage, setPage,
  };
}
