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

/** Serialize filter/sort/search/pagination into the query-shape the server's
 *  `parseQuery()` expects. Single source of truth for both the typed list
 *  fetch and the CSV-export URL. Filter encoding is delegated to
 *  `@sapporta/shared/filter` so the URL the router produces and the query
 *  this fetch layer sends use the same format. */
export function buildTableRowsQuery(
  params: Omit<FetchTableRowsParams, "tableName">,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (params.filters) {
    for (const [k, v] of encodeTypedFilters(params.filters)) out[k] = v;
  }
  if (params.page) out.page = String(params.page);
  if (params.limit) out.limit = String(params.limit);
  const sortStr = params.sort ? stringifySortOrder(params.sort) : null;
  if (sortStr) out.sort = sortStr;
  if (params.search) out.q = params.search;
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
