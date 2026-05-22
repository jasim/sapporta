import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchTableRows } from "@/table/api/rows";
import type { SortDescriptor } from "@/grid";
import type { Row } from "@sapporta/shared/contracts";
import {
  normalizeFilters,
  type FilterCondition,
} from "@sapporta/shared/filter";

export interface UseTableDataResult {
  rows: Row[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  page: number;
  pages: number;
  reload: () => void;
  setPage: (page: number) => void;
}

/**
 * Hook for fetching paginated table data from a custom view component.
 *
 * Auto-fetches on mount and whenever params change. This is a lightweight
 * standalone hook for simple read-only data display in custom views.
 * Use the table route's grid runtime for FK lookups, inline editing,
 * nested levels, and URL-synced table chrome.
 */
export function useTableData(
  tableName: string,
  opts?: {
    limit?: number;
    sort?: SortDescriptor[];
    /** Scalar equality filters — convenience for the common "give me this
     *  subset" call site. For anything beyond `eq`, pass
     *  `filterConditions` instead. */
    filters?: Record<string, string>;
    filterConditions?: FilterCondition[];
    page?: number;
  },
): UseTableDataResult {
  const limit = opts?.limit ?? 10;
  const sort = opts?.sort;
  const filtersRecord = opts?.filters ?? {};
  const conditionsOverride = opts?.filterConditions;

  const filterConditions = useMemo<FilterCondition[]>(() => {
    return normalizeFilters(conditionsOverride ?? filtersRecord);
    // Serialize for stable identity — the calling component reconstructs
    // the record on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filtersRecord), conditionsOverride]);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(opts?.page ?? 1);
  const [pages, setPages] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTableRows({
        tableName,
        page,
        limit,
        sort,
        filters: filterConditions,
      });
      setRows(res.data);
      setTotalCount(res.meta.total);
      setPages(res.meta.pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [tableName, page, limit, sort, filterConditions]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    rows,
    loading,
    error,
    totalCount,
    page,
    pages,
    reload: load,
    setPage,
  };
}
