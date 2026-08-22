import { uiClient } from "../../platform/client";
import type { PaginatedRows, SingleRow } from "@sapporta/shared/contracts";
import type { RecordId } from "@sapporta/shared/record-id";
import type { QueryParamRecord } from "@sapporta/shared";

export type TableReadOptions = {
  signal?: AbortSignal;
};

export function requestTableRecordsPage(
  tableName: string,
  query: Readonly<QueryParamRecord>,
  options: TableReadOptions = {},
): Promise<PaginatedRows> {
  return uiClient.listRows({
    params: { tableName },
    query,
    fetchOptions: { signal: options.signal },
  });
}

export function requestTableRecord(
  tableName: string,
  recordId: RecordId,
  options: TableReadOptions = {},
): Promise<SingleRow> {
  return uiClient.getRow({
    params: { tableName, id: recordId },
    fetchOptions: { signal: options.signal },
  });
}
