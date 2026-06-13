import { uiClient } from "@/platform/client";
import type { ProjectInfo, TableSchema } from "@sapporta/shared/contracts";

export async function fetchSchema(): Promise<{ tables: TableSchema[] }> {
  return uiClient.listTables({ query: {} });
}

export async function fetchProjectInfo(): Promise<ProjectInfo> {
  return uiClient.projectInfo();
}
