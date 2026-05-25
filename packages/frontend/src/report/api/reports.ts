import { uiClient } from "@/platform/client";
import type { ReportResult } from "@sapporta/shared/contracts";

/** Coerces parameter values to strings (the wire format) and drops
 *  null/undefined so the report engine sees defaults for those keys. */
export async function executeReport(
  name: string,
  params: Record<string, unknown>,
): Promise<ReportResult> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      query[key] = String(value);
    }
  }
  return uiClient.runReport({ params: { name }, query });
}
