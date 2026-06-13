import { z } from "zod";
import type { SqlClient, OperationResult } from "../introspect/types.js";
import { OperationError, ErrorCode } from "../introspect/types.js";
import { rejectDangerousSQL } from "../introspect/sql-safety.js";
import {
  buildInsertQuery,
  assertTableExists,
  getTableColumns,
} from "../introspect/db-helpers.js";
import { formatTable } from "./format.js";
import {
  validateTableName,
  validateColumnNames,
  rejectControlChars,
} from "../introspect/sql-safety.js";

export const rowsInsertMasterDetailInput = z.object({
  masterTable: z.string().describe("Master table name"),
  masterData: z.string().describe("JSON object for master record"),
  detailTable: z.string().describe("Detail table name"),
  detailData: z.string().describe("JSON array of detail records"),
  detailFk: z
    .string()
    .describe("FK column name on detail table (e.g. 'order_id')"),
  dryRun: z.boolean().optional().describe("Validate without executing"),
});

/**
 * Insert a master record and its detail records atomically.
 * The master record's ID is backfilled into each detail record's FK column.
 *
 * Flags:
 *   --master-table    Master table name
 *   --master-data     JSON object for master record
 *   --detail-table    Detail table name
 *   --detail-data     JSON array of detail records (without FK column)
 *   --detail-fk       FK column name on detail table (e.g. "order_id")
 *   --dry-run         Validate without executing
 *
 * Returns detail rows as primary data, with the master row in meta.
 * Both master and detail inserts happen inside a single transaction.
 */
export async function rowsInsertMasterDetail(
  sql: SqlClient,
  flags: Record<string, string>,
): Promise<OperationResult> {
  const masterTable = flags["master-table"];
  const masterDataJson = flags["master-data"];
  const detailTable = flags["detail-table"];
  const detailDataJson = flags["detail-data"];
  const detailFk = flags["detail-fk"];
  const dryRun = flags["dry-run"] === "true";

  if (
    !masterTable ||
    !masterDataJson ||
    !detailTable ||
    !detailDataJson ||
    !detailFk
  ) {
    throw new OperationError(
      "Usage: sapporta rows insert-master-detail " +
        "--master-table T --master-data '{}' " +
        "--detail-table T --detail-data '[{}]' " +
        "--detail-fk column_name",
      ErrorCode.MISSING_ARGUMENT,
    );
  }

  // Validate table names and FK column using shared identifier checks.
  // validateTableName/validateColumnNames throw OperationError on invalid input.
  validateTableName(masterTable);
  validateTableName(detailTable);
  validateColumnNames([detailFk]);

  // Reject control characters before parsing -- agents sometimes produce
  // invisible chars that would silently corrupt data in the database.
  rejectControlChars(masterDataJson);
  rejectControlChars(detailDataJson);

  const masterData = JSON.parse(masterDataJson);
  const detailRows = JSON.parse(detailDataJson);

  if (!Array.isArray(detailRows)) {
    throw new OperationError(
      "--detail-data must be a JSON array",
      ErrorCode.INVALID_JSON,
    );
  }

  // Validate all column names upfront
  validateColumnNames(Object.keys(masterData));
  for (const detail of detailRows) {
    validateColumnNames(Object.keys(detail));
  }

  if (dryRun) {
    return dryRunValidation(
      sql,
      masterTable,
      masterData,
      detailTable,
      detailRows,
      detailFk,
    );
  }

  // All inserts happen in a single transaction.
  // The master row's id is backfilled into each detail row's FK column.
  const { masterRow, detailResults } = await sql.begin(async (tx) => {
    // 1. Insert master record
    const { query: masterQuery, values: masterValues } = buildInsertQuery(
      masterTable,
      masterData,
    );
    rejectDangerousSQL(masterQuery);
    const [masterRow] = await tx.unsafe(masterQuery, masterValues);
    const masterId = masterRow.id;

    // 2. Insert detail records with FK backfill
    const detailResults: any[] = [];
    for (const detail of detailRows) {
      const row = { ...detail, [detailFk]: masterId };
      const { query, values } = buildInsertQuery(detailTable, row);
      rejectDangerousSQL(query);
      const inserted = await tx.unsafe(query, values);
      detailResults.push(...inserted);
    }

    return { masterRow, detailResults };
  });

  // Build table-mode output that matches the original two-section format
  const additionalOutput =
    `\nInserted ${detailResults.length} detail row(s) into ${detailTable}:\n` +
    formatTable(detailResults);

  return {
    ok: true,
    data: [masterRow],
    meta: {
      message: `Inserted master row into ${masterTable} (id: ${masterRow.id}):`,
      masterTable,
      detailTable,
      detailRows: detailResults,
      detailCount: detailResults.length,
      additionalOutput,
    },
  };
}

/**
 * Dry-run validation for master-detail insert.
 * Checks that both tables exist and all columns in the payloads are valid.
 * Does NOT execute any inserts.
 *
 * Delegates to shared primitives (assertTableExists, getTableColumns)
 * from cli-utils.ts. The FK column is validated separately since it's not
 * in the detail payload but must exist in the detail table.
 */
async function dryRunValidation(
  sql: SqlClient,
  masterTable: string,
  masterData: Record<string, unknown>,
  detailTable: string,
  detailRows: Record<string, unknown>[],
  detailFk: string,
): Promise<OperationResult> {
  // Validate both tables exist
  await assertTableExists(sql as any, masterTable);
  await assertTableExists(sql as any, detailTable);

  // Validate master columns against actual schema
  const masterDbCols = await getTableColumns(sql as any, masterTable);
  const unknownMasterCols = Object.keys(masterData).filter(
    (c) => !masterDbCols.has(c),
  );
  if (unknownMasterCols.length > 0) {
    throw new OperationError(
      `Unknown column(s) in '${masterTable}': ${unknownMasterCols.join(", ")}`,
      ErrorCode.INVALID_COLUMN_NAME,
    );
  }

  // Validate detail columns (including FK column which isn't in the payload
  // but must exist in the table for the backfill to work)
  const detailDbCols = await getTableColumns(sql as any, detailTable);
  if (!detailDbCols.has(detailFk)) {
    throw new OperationError(
      `FK column '${detailFk}' not found in '${detailTable}'`,
      ErrorCode.INVALID_COLUMN_NAME,
    );
  }
  const allDetailPayloadCols = [
    ...new Set(detailRows.flatMap((r) => Object.keys(r))),
  ];
  const unknownDetailCols = allDetailPayloadCols.filter(
    (c) => !detailDbCols.has(c),
  );
  if (unknownDetailCols.length > 0) {
    throw new OperationError(
      `Unknown column(s) in '${detailTable}': ${unknownDetailCols.join(", ")}`,
      ErrorCode.INVALID_COLUMN_NAME,
    );
  }

  return {
    ok: true,
    data: [masterData as Record<string, unknown>],
    meta: {
      message: `Dry run: 1 master row + ${detailRows.length} detail row(s) would be inserted`,
      dryRun: true,
      masterTable,
      detailTable,
      detailRows,
      detailCount: detailRows.length,
      validationPassed: true,
      tableOutputHandled: true,
    },
  };
}
