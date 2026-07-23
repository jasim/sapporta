import { and, eq, or, sql, type SQL } from "drizzle-orm";
import {
  alias,
  getTableConfig,
  type AnySQLiteTable,
  type SQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type { SapportaAuthContext } from "../auth/context.js";
import { columnBySqlName } from "../auth/row-scope.js";
import type { TableDef } from "../schema/table.js";
import type {
  ChildSearchPlan,
  SearchPlan,
  SearchValuePlan,
} from "./search-plan.js";

type BoundTable = {
  readonly table: TableDef;
  readonly from: SQL;
};

/**
 * Binds a compiled search plan to one request's authorization context.
 *
 * Inaccessible branches are omitted. If no configured value is readable, the
 * predicate is deliberately false so search cannot reveal row existence.
 */
export function buildSearchPredicate(
  plan: SearchPlan,
  searchTerm: string,
  auth: SapportaAuthContext,
): SQL {
  if (
    plan.disabled ||
    !auth.ability.can("read", plan.table.sqlName) ||
    searchTerm.trim() === ""
  ) {
    return sql`0`;
  }

  let aliasCounter = 0;
  const pattern = `%${escapeLike(searchTerm.trim())}%`;
  const root: BoundTable = {
    table: plan.table,
    from: sql`${sql.identifier(plan.table.sqlName)}`,
  };

  return compileNode(plan, root, true) ?? sql`0`;

  function compileNode(
    node: SearchPlan,
    source: BoundTable,
    isRoot: boolean,
  ): SQL | undefined {
    if (!isRoot && !auth.ability.can("read", node.table.sqlName)) {
      return undefined;
    }

    const predicates: SQL[] = [];
    for (const value of node.self) {
      const predicate = compileValue(value, source);
      if (predicate) predicates.push(predicate);
    }
    for (const child of node.children) {
      const predicate = compileChild(child, source);
      if (predicate) predicates.push(predicate);
    }
    return combineOr(predicates);
  }

  function compileValue(
    value: SearchValuePlan,
    source: BoundTable,
  ): SQL | undefined {
    if (value.kind === "column") {
      return substringPredicate(
        requireBoundColumn(source.table, value.column.name),
      );
    }

    if (!auth.ability.can("read", value.targetTable.sqlName)) {
      return undefined;
    }

    const target = bindAlias(value.targetTable);
    const sourceColumn = requireBoundColumn(
      source.table,
      value.sourceColumn.name,
    );
    const targetColumn = requireBoundColumn(
      target.table,
      value.targetColumn.name,
    );
    const label = concatenateLabel(
      target.table,
      value.labelColumns.map((column) => column.name),
    );
    const visibleMatch = auth.rowSecurity
      .forTable(target.table)
      .ownedRows(
        and(eq(targetColumn, sourceColumn), substringPredicate(label)),
      );

    return sql`exists (select 1 from ${target.from} where ${visibleMatch})`;
  }

  function compileChild(
    child: ChildSearchPlan,
    parent: BoundTable,
  ): SQL | undefined {
    if (!auth.ability.can("read", child.childTable.sqlName)) {
      return undefined;
    }

    const boundChild = bindAlias(child.childTable);
    const childPredicate = compileNode(child.plan, boundChild, false);
    if (!childPredicate) return undefined;

    const childForeignKey = requireBoundColumn(
      boundChild.table,
      child.childForeignKey.name,
    );
    const parentTarget = requireBoundColumn(
      parent.table,
      child.parentTargetColumn.name,
    );
    const visibleMatch = auth.rowSecurity
      .forTable(boundChild.table)
      .ownedRows(and(eq(childForeignKey, parentTarget), childPredicate));

    return sql`exists (select 1 from ${boundChild.from} where ${visibleMatch})`;
  }

  function bindAlias(table: TableDef): BoundTable {
    aliasCounter += 1;
    const aliasName = `sapporta_search_${aliasCounter}`;
    const aliasedDrizzle = alias(table.drizzle, aliasName) as AnySQLiteTable;
    return {
      table: {
        ...table,
        drizzle: aliasedDrizzle,
      },
      from: sql`${sql.identifier(getTableConfig(table.drizzle).name)} as ${sql.identifier(aliasName)}`,
    };
  }

  function substringPredicate(expression: SQLiteColumn | SQL): SQL {
    return sql`lower(coalesce(cast(${expression} as text), '')) like lower(${pattern}) escape '\\'`;
  }
}

function concatenateLabel(table: TableDef, names: readonly string[]): SQL {
  const columns = names.map((name) => requireBoundColumn(table, name));
  const first = columns[0];
  if (!first) return sql`''`;

  return columns
    .slice(1)
    .reduce(
      (expression, column) =>
        sql`${expression} || ' ' || coalesce(cast(${column} as text), '')`,
      sql`coalesce(cast(${first} as text), '')`,
    );
}

function requireBoundColumn(table: TableDef, name: string): SQLiteColumn {
  const column = columnBySqlName(table, name);
  if (!column) {
    throw new Error(
      `Compiled search column "${table.sqlName}.${name}" could not be bound.`,
    );
  }
  return column;
}

function combineOr(predicates: readonly SQL[]): SQL | undefined {
  if (predicates.length === 0) return undefined;
  if (predicates.length === 1) return predicates[0];
  return or(...predicates);
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
