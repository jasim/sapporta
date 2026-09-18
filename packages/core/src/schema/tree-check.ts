import { resolveTableReferences } from "../auth/schema-validation.js";
import { findPkColumn } from "./pk.js";
import type { TableDef } from "./table.js";

export interface TreeMetaIssue {
  readonly table: string;
  readonly column: string;
  readonly message: string;
}

export class TreeMetaValidationError extends Error {
  public readonly issues: readonly TreeMetaIssue[];

  constructor(issues: readonly TreeMetaIssue[]) {
    super(
      `Tree metadata validation failed: ${issues
        .map((issue) => `${issue.table}.${issue.column}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "TreeMetaValidationError";
    this.issues = issues;
  }
}

/**
 * Checks each `meta.tree` against the other tables: the parent column must be
 * a single-column foreign key, declared with Drizzle `.references()` or a
 * `meta.references` rule, to the same table's primary key. The table-local
 * rules (known, nullable, visible columns) run in `sapportaTable()`.
 */
export function checkTableTrees(tables: readonly TableDef[]): TreeMetaIssue[] {
  const issues: TreeMetaIssue[] = [];
  for (const table of tables) {
    const tree = table.meta.tree;
    if (!tree) continue;
    const primaryKey = findPkColumn(table).name;
    const expected = `${table.sqlName}.${primaryKey}`;
    const reference = resolveTableReferences(table, tables).references.find(
      (candidate) => candidate.sourceColumn === tree.parentColumn,
    );
    if (!reference) {
      issues.push({
        table: table.sqlName,
        column: tree.parentColumn,
        message: `tree.parentColumn must be a foreign key to "${expected}". Declare it with .references() or meta.references.`,
      });
      continue;
    }
    if (
      reference.targetTable !== table ||
      reference.targetColumnRef.name !== primaryKey
    ) {
      issues.push({
        table: table.sqlName,
        column: tree.parentColumn,
        message: `tree.parentColumn references "${reference.targetTable.sqlName}.${reference.targetColumn}", but it must reference "${expected}".`,
      });
    }
  }
  return issues;
}

export function assertTableTrees(tables: readonly TableDef[]): void {
  const issues = checkTableTrees(tables);
  if (issues.length > 0) throw new TreeMetaValidationError(issues);
}
