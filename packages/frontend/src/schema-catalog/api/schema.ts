import {
  tableSchemaSchema,
  type ProjectInfo,
  type TableSchema,
} from "@sapporta/shared/contracts";
import { fetchApiJson } from "../../platform/http";
import { z } from "zod";

/**
 * Load and validate the server's browser-safe table model.
 *
 * Parsing here turns the metadata endpoint into a runtime boundary rather than
 * a TypeScript-only assertion. Table form and grid decoders can therefore rely
 * on required facts such as `ColumnSchema.kind` after this promise resolves.
 */
export async function fetchSchema(): Promise<{ tables: TableSchema[] }> {
  const body = await fetchApiJson<unknown>("/meta/tables");
  return tableSchemaResponseSchema.parse(body);
}

const tableSchemaResponseSchema = z.object({
  tables: z.array(tableSchemaSchema),
});

export async function fetchProjectInfo(): Promise<ProjectInfo> {
  return fetchApiJson<ProjectInfo>("/meta/info");
}
