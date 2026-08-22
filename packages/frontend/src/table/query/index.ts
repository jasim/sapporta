import {
  queryOptions,
  type DataTag,
  type QueryKey,
  type UndefinedInitialDataOptions,
} from "@tanstack/react-query";
import type { PaginatedRows, Row } from "@sapporta/shared/contracts";
import type { RecordId } from "@sapporta/shared/record-id";
import type { QueryParamRecord } from "@sapporta/shared";
import { buildTableRowsQuery, type FetchTableRowsParams } from "../api/rows";
import {
  requestTableRecord,
  requestTableRecordsPage,
} from "../api/read-table-data";

const allTablesQueryKey = ["sapporta", "tables"] as const;

function tableQueryKey(tableName: string) {
  return [...allTablesQueryKey, tableName] as const;
}

function tableRecordsQueryKey(tableName: string) {
  return [...tableQueryKey(tableName), "records"] as const;
}

function tableRecordQueryKey(tableName: string, recordId: RecordId) {
  return [...tableRecordsQueryKey(tableName), recordId] as const;
}

function tableRecordsPagesQueryKey(tableName: string) {
  return [...tableQueryKey(tableName), "pages"] as const;
}

function tableRecordsPageQueryKey(
  tableName: string,
  query: Readonly<QueryParamRecord>,
) {
  return [...tableRecordsPagesQueryKey(tableName), query] as const;
}

function tableRecordsPageQuery(params: FetchTableRowsParams) {
  const { tableName: _tableName, ...request } = params;
  return Object.freeze(buildTableRowsQuery(request));
}

/** Cache-key hierarchy for generic table reads. Prefixes support invalidating
 * every table, one table, its individual records, or its paginated lists. */
export const tableQueryKeys = {
  all: allTablesQueryKey,
  table: tableQueryKey,
  records: tableRecordsQueryKey,
  record: tableRecordQueryKey,
  pages: tableRecordsPagesQueryKey,
  page: (params: FetchTableRowsParams) =>
    tableRecordsPageQueryKey(params.tableName, tableRecordsPageQuery(params)),
} as const;

export type TableRecordQueryKey = ReturnType<typeof tableQueryKeys.record>;
export type TableRecordsPageQueryKey = ReturnType<typeof tableQueryKeys.page>;

export type TableRowDecoder<TRow> = (row: Row) => TRow;

export type TableRecordsPage<TRow> = Omit<PaginatedRows, "data"> & {
  data: TRow[];
};

export type TableRecordQueryArgs = {
  tableName: string;
  recordId: RecordId;
};

export type DecodedTableRecordQueryArgs<TRow> = TableRecordQueryArgs & {
  decodeRow: TableRowDecoder<TRow>;
};

export type DecodedTableRecordsPageQueryArgs<TRow> = FetchTableRowsParams & {
  decodeRow: TableRowDecoder<TRow>;
};

type BuiltQueryOptions<
  TData,
  TQueryKey extends QueryKey,
> = UndefinedInitialDataOptions<TData, Error, TData, TQueryKey> & {
  queryKey: DataTag<TQueryKey, TData, Error>;
};

export function tableRecordQueryOptions(
  args: TableRecordQueryArgs,
): BuiltQueryOptions<Row, TableRecordQueryKey>;
export function tableRecordQueryOptions<TRow>(
  args: DecodedTableRecordQueryArgs<TRow>,
): BuiltQueryOptions<TRow, TableRecordQueryKey>;
export function tableRecordQueryOptions<TRow>(
  args: TableRecordQueryArgs | DecodedTableRecordQueryArgs<TRow>,
) {
  const queryKey = tableQueryKeys.record(args.tableName, args.recordId);

  if ("decodeRow" in args) {
    return queryOptions({
      queryKey,
      queryFn: async ({ signal }) => {
        const response = await requestTableRecord(
          args.tableName,
          args.recordId,
          { signal },
        );
        return args.decodeRow(response.data);
      },
    });
  }

  return queryOptions({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await requestTableRecord(args.tableName, args.recordId, {
        signal,
      });
      return response.data;
    },
  });
}

export function tableRecordsPageQueryOptions(
  args: FetchTableRowsParams,
): BuiltQueryOptions<TableRecordsPage<Row>, TableRecordsPageQueryKey>;
export function tableRecordsPageQueryOptions<TRow>(
  args: DecodedTableRecordsPageQueryArgs<TRow>,
): BuiltQueryOptions<TableRecordsPage<TRow>, TableRecordsPageQueryKey>;
export function tableRecordsPageQueryOptions<TRow>(
  args: FetchTableRowsParams | DecodedTableRecordsPageQueryArgs<TRow>,
) {
  const query = tableRecordsPageQuery(args);
  const queryKey = tableRecordsPageQueryKey(args.tableName, query);

  if ("decodeRow" in args) {
    return queryOptions({
      queryKey,
      queryFn: async ({ signal }) => {
        const response = await requestTableRecordsPage(args.tableName, query, {
          signal,
        });
        return {
          ...response,
          data: response.data.map(args.decodeRow),
        };
      },
    });
  }

  return queryOptions({
    queryKey,
    queryFn: ({ signal }) =>
      requestTableRecordsPage(args.tableName, query, { signal }),
  });
}
