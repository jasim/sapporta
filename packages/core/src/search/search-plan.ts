import { getTableConfig, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  resolveTableReferences,
  type AuthSchemaIssue,
} from "../auth/schema-validation.js";
import {
  isSystemManagedScopeFieldName,
  type ResolvedReferenceFact,
} from "../auth/row-scope.js";
import { findPkColumn } from "../schema/pk.js";
import type { TableDef } from "../schema/table.js";
import type { NormalizedTableSearch, SearchSelf } from "./search-types.js";

export type SearchValuePlan =
  | {
      readonly kind: "column";
      readonly column: SQLiteColumn;
    }
  | {
      readonly kind: "referenceLabel";
      readonly sourceColumn: SQLiteColumn;
      readonly targetTable: TableDef;
      readonly targetColumn: SQLiteColumn;
      readonly labelColumns: readonly SQLiteColumn[];
    };

export interface ChildSearchPlan {
  readonly childTable: TableDef;
  readonly childForeignKey: SQLiteColumn;
  readonly parentTargetColumn: SQLiteColumn;
  readonly plan: SearchPlan;
}

export interface SearchPlan {
  readonly table: TableDef;
  readonly disabled: boolean;
  readonly self: readonly SearchValuePlan[];
  readonly children: readonly ChildSearchPlan[];
}

export interface SearchPlanIssue {
  readonly table: string;
  readonly path: string;
  readonly message: string;
}

export interface SearchPlanWarning {
  readonly table: string;
  readonly column: string;
  readonly message: string;
}

export class SearchPlanValidationError extends Error {
  public readonly issues: readonly SearchPlanIssue[];

  constructor(issues: readonly SearchPlanIssue[]) {
    super(
      `Search configuration validation failed: ${issues
        .map((issue) => `${issue.table}.${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "SearchPlanValidationError";
    this.issues = issues;
  }
}

export interface CompiledSearchPlans {
  readonly plans: ReadonlyMap<string, SearchPlan>;
  readonly warnings: readonly SearchPlanWarning[];
}

/**
 * Resolves every table's recursive search metadata into immutable table and
 * column facts. Invalid relationships fail here, before request handling.
 */
export function compileSearchPlans(
  tables: readonly TableDef[],
): CompiledSearchPlans {
  const byName = new Map(tables.map((table) => [table.sqlName, table]));
  const references = new Map<
    TableDef,
    {
      facts: readonly ResolvedReferenceFact[];
      issues: readonly AuthSchemaIssue[];
    }
  >();
  const issues: SearchPlanIssue[] = [];
  const warnings: SearchPlanWarning[] = [];

  for (const table of tables) {
    const resolved = resolveTableReferences(table, tables);
    references.set(table, {
      facts: resolved.references,
      issues: resolved.issues,
    });
  }

  const plans = new Map<string, SearchPlan>();
  for (const table of tables) {
    const plan =
      table.meta.search === false
        ? disabledPlan(table)
        : compileNode(table, table.meta.search, "search");
    plans.set(table.sqlName, plan);
  }

  if (issues.length > 0) throw new SearchPlanValidationError(issues);

  return {
    plans,
    warnings: Object.freeze(warnings),
  };

  function compileNode(
    table: TableDef,
    search: Exclude<NormalizedTableSearch, false>,
    path: string,
  ): SearchPlan {
    if (search === "allColumns") {
      return Object.freeze({
        table,
        disabled: false,
        self: Object.freeze(compileSelf(table, "allColumns", path)),
        children: Object.freeze([]),
      });
    }

    const children: ChildSearchPlan[] = [];
    for (const [childName, childSearch] of Object.entries(search.children)) {
      if (childSearch === false) continue;
      const relation = resolveChild(table, childName, `${path}.children`);
      if (!relation) continue;

      const childPlan = compileNode(
        relation.childTable,
        childSearch,
        `${path}.children.${childName}`,
      );
      children.push(
        Object.freeze({
          ...relation,
          plan: childPlan,
        }),
      );
      warnIfChildForeignKeyIsUnindexed(
        relation.childTable,
        relation.childForeignKey,
      );
    }

    return Object.freeze({
      table,
      disabled: false,
      self: Object.freeze(compileSelf(table, search.self, path)),
      children: Object.freeze(children),
    });
  }

  function compileSelf(
    table: TableDef,
    self: SearchSelf,
    path: string,
  ): SearchValuePlan[] {
    if (self === false) return [];

    const config = getTableConfig(table.drizzle);
    const columns =
      self === "allColumns"
        ? config.columns.filter(
            (column) =>
              !isSystemManagedScopeFieldName(column.name) &&
              table.meta.columns[column.name]?.visuallyHidden !== true,
          )
        : self.flatMap((name) => {
            const column = config.columns.find(
              (candidate) => candidate.name === name,
            );
            if (!column) {
              issues.push({
                table: table.sqlName,
                path: `${path}.self`,
                message: `Search column "${name}" does not exist.`,
              });
              return [];
            }
            if (isSystemManagedScopeFieldName(name)) {
              issues.push({
                table: table.sqlName,
                path: `${path}.self`,
                message: `System-managed ownership column "${name}" cannot be searched.`,
              });
              return [];
            }
            return [column];
          });

    const resolved = references.get(table)!;
    const referencesByColumn = new Map(
      resolved.facts.map((reference) => [reference.sourceColumn, reference]),
    );
    const referenceCandidates = new Set([
      ...Object.keys(table.meta.references),
      ...getTableConfig(table.drizzle).foreignKeys.flatMap((foreignKey) =>
        foreignKey.reference().columns.map((column) => column.name),
      ),
    ]);
    const plans: SearchValuePlan[] = [];

    for (const column of columns) {
      if (column.primary) {
        plans.push(Object.freeze({ kind: "column", column }));
        continue;
      }

      const reference = referencesByColumn.get(column.name);
      if (!reference) {
        if (referenceCandidates.has(column.name)) {
          addReferenceIssues(table, column.name, path, resolved.issues);
        } else {
          plans.push(Object.freeze({ kind: "column", column }));
        }
        continue;
      }

      const labelColumns = reference.targetTable.meta.rowLabelColumns.flatMap(
        (name) => {
          const labelColumn = getTableConfig(
            reference.targetTable.drizzle,
          ).columns.find((candidate) => candidate.name === name);
          if (!labelColumn) {
            issues.push({
              table: table.sqlName,
              path: `${path}.self.${column.name}`,
              message: `Row-label column "${name}" does not exist on referenced table "${reference.targetTable.sqlName}".`,
            });
            return [];
          }
          return [labelColumn];
        },
      );
      plans.push(
        Object.freeze({
          kind: "referenceLabel",
          sourceColumn: column,
          targetTable: reference.targetTable,
          targetColumn: reference.targetColumnRef,
          labelColumns: Object.freeze(labelColumns),
        }),
      );
    }

    return plans;
  }

  function resolveChild(
    parent: TableDef,
    childName: string,
    path: string,
  ): Omit<ChildSearchPlan, "plan"> | null {
    const declarations = parent.meta.children.filter(
      (child) => child.table === childName,
    );
    if (declarations.length !== 1) {
      issues.push({
        table: parent.sqlName,
        path,
        message:
          declarations.length === 0
            ? `Search child "${childName}" is not declared in meta.children.`
            : `Search child "${childName}" is ambiguous because it is declared more than once.`,
      });
      return null;
    }

    const childTable = byName.get(childName);
    if (!childTable) {
      issues.push({
        table: parent.sqlName,
        path,
        message: `Search child table "${childName}" is not registered.`,
      });
      return null;
    }

    const declaration = declarations[0]!;
    const childForeignKey = getTableConfig(childTable.drizzle).columns.find(
      (column) => column.name === declaration.foreignKey,
    );
    if (!childForeignKey) {
      issues.push({
        table: parent.sqlName,
        path,
        message: `Child relationship column "${childName}.${declaration.foreignKey}" does not exist.`,
      });
      return null;
    }

    const resolved = references.get(childTable)!;
    const relationship = resolved.facts.find(
      (reference) => reference.sourceColumn === declaration.foreignKey,
    );
    if (!relationship) {
      addReferenceIssues(
        childTable,
        declaration.foreignKey,
        path,
        resolved.issues,
      );
      if (
        !resolved.issues.some(
          (issue) => issue.column === declaration.foreignKey,
        )
      ) {
        issues.push({
          table: parent.sqlName,
          path,
          message: `Child relationship "${childName}.${declaration.foreignKey}" is not a declared foreign key.`,
        });
      }
      return null;
    }

    const parentPrimaryKey = findPkColumn(parent);
    if (
      relationship.targetTable !== parent ||
      relationship.targetColumnRef.name !== parentPrimaryKey.name
    ) {
      issues.push({
        table: parent.sqlName,
        path,
        message: `Child relationship "${childName}.${declaration.foreignKey}" must reference "${parent.sqlName}.${parentPrimaryKey.name}".`,
      });
      return null;
    }

    return {
      childTable,
      childForeignKey,
      parentTargetColumn: parentPrimaryKey,
    };
  }

  function addReferenceIssues(
    table: TableDef,
    column: string,
    path: string,
    authIssues: readonly AuthSchemaIssue[],
  ): void {
    const matching = authIssues.filter((issue) => issue.column === column);
    if (matching.length === 0) {
      issues.push({
        table: table.sqlName,
        path,
        message: `Foreign-key search column "${column}" could not be resolved.`,
      });
      return;
    }
    for (const issue of matching) {
      issues.push({
        table: table.sqlName,
        path,
        message: issue.message,
      });
    }
  }

  function warnIfChildForeignKeyIsUnindexed(
    childTable: TableDef,
    foreignKey: SQLiteColumn,
  ): void {
    const indexed = getTableConfig(childTable.drizzle).indexes.some(
      (index) => index.config.columns[0] === foreignKey,
    );
    if (indexed) return;
    if (
      warnings.some(
        (warning) =>
          warning.table === childTable.sqlName &&
          warning.column === foreignKey.name,
      )
    ) {
      return;
    }
    warnings.push({
      table: childTable.sqlName,
      column: foreignKey.name,
      message: `Searchable child foreign key "${childTable.sqlName}.${foreignKey.name}" should be indexed.`,
    });
  }
}

function disabledPlan(table: TableDef): SearchPlan {
  return Object.freeze({
    table,
    disabled: true,
    self: Object.freeze([]),
    children: Object.freeze([]),
  });
}
