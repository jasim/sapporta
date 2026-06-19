import { Hono } from "hono";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { normalizeDataType } from "./normalize-datatype.js";
import { resolveColumnKind } from "./resolve-kind.js";
import { findPkColumn } from "./pk.js";
import { isAutoManagedTimestampColumn, type TableDef } from "./table.js";
import { logger } from "../db/logger.js";
import { findRowLabelColumns } from "../data/row-label.js";
import { defaultColumnLabel } from "@sapporta/shared";
import type {
  ChildSchema,
  ColumnSchema,
  ReportLink,
  TableSchema,
} from "@sapporta/shared/contracts";

const log = logger.child({ module: "schema" });

/**
 * Extract schema metadata from loaded TableDefs.
 *
 * Used by GET /api/_schema and available for direct use in tests.
 */
export function extractSchemas(defs: readonly TableDef[]): TableSchema[] {
  // Build a lookup by sqlName for resolving children
  const byName = new Map<string, TableDef>();
  for (const def of defs) byName.set(def.sqlName, def);

  return defs.map((schema) => {
    const config = getTableConfig(schema.drizzle);

    // Build FK lookup: column name → { table, column }
    const fkMap = new Map<string, { table: string; column: string }>();
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      // ref.foreignColumns[0] is the target column, ref.columns[0] is the source column
      const sourceCol = ref.columns[0];
      const targetCol = ref.foreignColumns[0];
      if (sourceCol && targetCol) {
        const targetConfig = getTableConfig(targetCol.table);
        fkMap.set(sourceCol.name, {
          table: targetConfig.name,
          column: targetCol.name,
        });
      }
    }

    // Build select lookup
    const selectMap = new Map<string, string[]>();
    if (schema.meta.selects) {
      for (const s of schema.meta.selects) {
        selectMap.set(s.column, s.options);
      }
    }

    const columns: ColumnSchema[] = config.columns.map((col) => {
      const columnMeta = schema.meta.columns[col.name];
      const colSchema: ColumnSchema = {
        name: col.name,
        // Drizzle's internal dataType differs between dialects (e.g. Pg string-mode
        // timestamps report "string", not "date"). normalizeDataType() provides a
        // stable, dialect-agnostic value for UI formatting.
        dataType: normalizeDataType(col),
        notNull: col.notNull,
        hasDefault: col.hasDefault,
        primary: col.primary,
        isUnique: col.isUnique,
        foreignKey: fkMap.get(col.name) ?? null,
        select: selectMap.has(col.name)
          ? { options: selectMap.get(col.name)! }
          : null,
        // Factories stamp `kind` in `meta.columns`; hand-declared Drizzle
        // columns derive it from the normalized dataType. This guarantees
        // every extracted column has a `kind`, so downstream consumers
        // (UI display, operator applicability, parse) read a single field.
        kind: resolveColumnKind(schema, col.name),
        displayFormat: columnMeta?.displayFormat,
        textDisplay: columnMeta?.textDisplay,
        label: columnMeta?.label ?? defaultColumnLabel(col.name),
        width: columnMeta?.width,
        minWidth: columnMeta?.minWidth,
        maxWidth: columnMeta?.maxWidth,
        colorRule: columnMeta?.colorRule,
        zeroDisplay: columnMeta?.zeroDisplay,
        strong: columnMeta?.strong,
        notes: columnMeta?.notes,
        clientEditable: columnMeta?.clientEditable,
        visuallyHidden: columnMeta?.visuallyHidden,
      };

      // Auto-synthesize a drill-up link for FK columns. Consumers (table &
      // report grids) render cell navigation uniformly from `links` — the FK
      // case is just a default, not a parallel mechanism.
      const fk = colSchema.foreignKey;
      if (fk) {
        colSchema.links = [
          {
            kind: "table",
            table: fk.table,
            bind: { [fk.column]: col.name },
            icon: "drill-up",
          },
        ];
      }

      return colSchema;
    });

    // Parent PK — needed to synthesize row-level drill-into links. Row-label
    // columns are declared in table metadata so references display useful text.
    const parentPkName = findPkColumn(schema).name;
    const rowLabelColumns = [...findRowLabelColumns(schema)];

    // Resolve children
    const children: ChildSchema[] = [];
    for (const childMeta of schema.meta.children) {
      const childDef = byName.get(childMeta.table);
      if (!childDef) {
        log.warn("Child table not found, skipping", {
          parent: schema.sqlName,
          child: childMeta.table,
        });
        continue;
      }

      const childConfig = getTableConfig(childDef.drizzle);
      const pkColName = findPkColumn(childDef).name;

      // Default columns: all except PK, the FK column, and managed timestamps.
      const excludeCols = new Set([pkColName, childMeta.foreignKey]);
      const resolvedColumns =
        childMeta.columns ??
        childConfig.columns
          .map((c) => c.name)
          .filter(
            (name) =>
              !excludeCols.has(name) && !isAutoManagedTimestampColumn(name),
          );

      children.push({
        table: childMeta.table,
        foreignKey: childMeta.foreignKey,
        label: childMeta.label ?? childDef.meta.label,
        columns: resolvedColumns,
        defaultSort: childMeta.defaultSort ?? pkColName,
        width: childMeta.width,
      });
    }

    // Auto-synthesize row-level drill-into links from children. One link per
    // child; bind maps the child's FK column → this table's PK on the row.
    const rowLinks: ReportLink[] = children.map((child) => ({
      kind: "table",
      table: child.table,
      bind: { [child.foreignKey]: parentPkName },
      label: `Open ${child.label}`,
      icon: "drill-into",
    }));

    return {
      name: schema.sqlName,
      label: schema.meta.label,
      immutable: schema.meta.immutable,
      columns,
      children,
      ...(rowLinks.length > 0 ? { rowLinks } : {}),
      rowLabelColumns,
      ...(schema.meta.search
        ? { search: { columns: schema.meta.search.columns } }
        : {}),
    };
  });
}

/**
 * Extract schema metadata for a single table by name.
 *
 * Used by GET /meta/tables/:name in metaApi(). Returns undefined if the table
 * is not found. Builds the full list internally (extractSchemas is pure and
 * fast — no I/O), then filters. For a project with many tables this could
 * be optimized to extract a single entry, but correctness is more important
 * here — the full extraction handles FK resolution and child references that
 * require the complete table set.
 */
export function extractSchema(
  source: readonly TableDef[],
  name: string,
): TableSchema | undefined {
  const all = extractSchemas(source);
  return all.find((s) => s.name === name);
}

/**
 * Standalone schema metadata endpoint (GET /).
 *
 * NOTE: In production, schema introspection is served by metaApi() which calls
 * extractSchemas() directly. This schemaApi() function exists as a convenience
 * for tests that want a self-contained Hono app without the full /meta namespace.
 *
 * Accepts loaded table definitions and computes schema metadata once.
 */
export function schemaApi(source: readonly TableDef[]) {
  const app = new Hono();
  const data = extractSchemas(source);
  app.get("/", (c) => c.json({ tables: data }));

  return app;
}
