import { getTableConfig } from "drizzle-orm/sqlite-core";
import { isDateObjectMode } from "./normalize-datatype.js";
import type { TableDef } from "./table.js";

export type SchemaIssue = {
  table: string;
  column: string;
  message: string;
};

/**
 * Check schema definitions for nullable numeric columns that should be NOT NULL.
 *
 * Three categories of nullable numeric columns:
 *
 * 1. **FK columns** (e.g. `parent_id`) — nullable because the relationship is
 *    optional. Never aggregated. Auto-detected from Drizzle foreign key metadata.
 *
 * 2. **Additive measures** (e.g. `debit`, `credit`) — values where NULL breaks
 *    SUM/AVG. Must be NOT NULL with .default("0").
 *
 * 3. **Non-additive optionals** (e.g. `account_balance_assertion`) — NULL means
 *    "no value" and 0 means "value is zero". Legitimately nullable. Marked with
 *    `additive: false` in column meta.
 *
 * This checker flags category 2 — nullable numerics that are not FK columns and
 * not explicitly marked as non-additive.
 */
export function checkSchemaDefinitions(tables: TableDef[]): SchemaIssue[] {
  const issues: SchemaIssue[] = [];

  for (const table of tables) {
    const config = getTableConfig(table.drizzle);

    // Build FK column set from Drizzle foreign key metadata
    const fkColumns = new Set<string>();
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      const sourceCol = ref.columns[0];
      if (sourceCol) {
        fkColumns.add(sourceCol.name);
      }
    }

    for (const col of config.columns) {
      // Skip primary keys — never aggregated
      if (col.primary) continue;

      // Skip foreign key columns — nullable because the relationship is optional
      if (fkColumns.has(col.name)) continue;

      // Flag Date-object-mode timestamps (Pg default mode or SQLite mode: "timestamp").
      // These break in a JSON-over-HTTP framework because string values hit .toISOString().
      // See timestamp() in table.ts for the string-mode convention.
      if (isDateObjectMode(col)) {
        issues.push({
          table: config.name,
          column: col.name,
          message:
            `Timestamp column using Date mode. ` +
            `Sapporta is JSON-over-HTTP — dates arrive as strings, causing "toISOString is not a function" errors. ` +
            `Use import { timestamp } from "@sapporta/server/table" which returns a text column storing ISO 8601 strings.`,
        });
      }

      // SQLite integer and real both have dataType "number".
      // Currency/percentage columns stored as TEXT won't match "number",
      // which is correct — they shouldn't warn about nullable numerics
      // since they're text.
      const isNumeric = col.dataType === "number";

      if (!isNumeric || col.notNull) continue;

      // Skip columns explicitly marked as non-additive
      if (table.meta.columns?.[col.name]?.additive === false) continue;

      issues.push({
        table: config.name,
        column: col.name,
        message:
          `Nullable numeric column. ` +
          `A single NULL causes SUM/AVG to silently produce NULL instead of a number. ` +
          `Add .notNull() (with .default("0") if the column is optional). ` +
          `If NULL is semantically distinct from 0, mark it with { additive: false } in column meta.`,
      });
    }
  }

  return issues;
}
