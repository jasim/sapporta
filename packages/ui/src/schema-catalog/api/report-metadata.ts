import { uiClient } from "@/platform/client";
import type { ReportsListResponse } from "@sapporta/shared/contracts";

export async function fetchReports(): Promise<ReportsListResponse> {
  return uiClient.listReports();
}
