import { useState, useCallback } from "react";
import { executeReport } from "../services/reports";
import type { ReportResult } from "@sapporta/shared/contracts";
export interface UseReportResult {
  run: (params: Record<string, unknown>) => Promise<ReportResult>;
  result: ReportResult | null;
  loading: boolean;
  error: string | null;
}

/**
 * Hook for executing a Sapporta report from a custom view component.
 *
 * Unlike useTableData, reports are not auto-fetched on mount — the caller
 * must explicitly call `run(params)`. This is because reports typically
 * need user-supplied parameters (date range, account filter, etc.).
 */
export function useReport(reportName: string): UseReportResult {
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (params: Record<string, unknown>) => {
      setLoading(true);
      setError(null);
      try {
        const res = await executeReport(reportName, params);
        setResult(res);
        return res;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Report failed");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [reportName],
  );

  return { run, result, loading, error };
}
