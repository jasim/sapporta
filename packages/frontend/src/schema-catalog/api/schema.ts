import type { ProjectInfo, TableSchema } from "@sapporta/shared/contracts";
import { fetchApiJson } from "../../platform/http";

export async function fetchSchema(): Promise<{ tables: TableSchema[] }> {
  return fetchApiJson<{ tables: TableSchema[] }>("/meta/tables");
}

export async function fetchProjectInfo(): Promise<ProjectInfo> {
  return fetchApiJson<ProjectInfo>("/meta/info");
}
