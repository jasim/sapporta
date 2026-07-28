import { uiClient } from "../../platform/client";
import type { PaginatedRows, Row, SingleRow } from "@sapporta/shared/contracts";
import { stringifySortOrder } from "@sapporta/grid";
import type { SortDescriptor } from "@sapporta/grid";
import {
  encodeTypedFilters,
  type TypedFilterCondition,
} from "@sapporta/shared/filter";
import type { RowId } from "@sapporta/shared/row-id";
import {
  requestTableRecord,
  requestTableRecordsPage,
  type TableReadOptions,
} from "./read-table-data";

export type TableFetchOptions = TableReadOptions;

export interface FetchTableRowsParams {
  tableName: string;
  page?: number;
  limit?: number;
  sort?: SortDescriptor[];
  filters?: readonly TypedFilterCondition[];
  search?: string;
}

export type TableRowsSelectionParams = Pick<
  FetchTableRowsParams,
  "sort" | "filters" | "search"
>;

/** Serialize the filter, sort, and search selection shared by paged reads and
 *  CSV exports. Filter encoding is delegated to `@sapporta/shared/filter` so
 *  both surfaces use the same canonical URL grammar. */
export function buildTableSelectionQuery(
  params: TableRowsSelectionParams,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (params.filters) {
    for (const [k, v] of encodeTypedFilters(params.filters)) out[k] = v;
  }
  const sortStr = params.sort ? stringifySortOrder(params.sort) : null;
  if (sortStr) out.sort = sortStr;
  if (params.search) out.q = params.search;
  return out;
}

/** Add pagination to a table selection for the paged rows endpoint. */
export function buildTableRowsQuery(
  params: Omit<FetchTableRowsParams, "tableName">,
): Record<string, string> {
  const out = buildTableSelectionQuery(params);
  if (params.page) out.page = String(params.page);
  if (params.limit) out.limit = String(params.limit);
  return out;
}

export async function fetchTableRows(
  params: FetchTableRowsParams,
  options: TableFetchOptions = {},
): Promise<PaginatedRows> {
  const { tableName, ...rest } = params;
  return requestTableRecordsPage(tableName, buildTableRowsQuery(rest), options);
}

export async function fetchTableRow(
  tableName: string,
  recordId: RowId,
  options: TableFetchOptions = {},
): Promise<SingleRow> {
  return requestTableRecord(tableName, recordId, options);
}

export async function createTableRow(
  tableName: string,
  data: Row,
): Promise<{ data: Row | Row[] }> {
  return uiClient.createRow({ params: { tableName }, body: data });
}

export async function updateTableRow(
  tableName: string,
  id: RowId,
  data: Row,
): Promise<SingleRow> {
  return uiClient.updateRow({ params: { tableName, id }, body: data });
}

export async function deleteTableRow(
  tableName: string,
  id: RowId,
): Promise<SingleRow> {
  return uiClient.deleteRow({ params: { tableName, id } });
}
