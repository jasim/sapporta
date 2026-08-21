import { Hono } from "hono";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { normalizeDataType } from "./normalize-datatype.js";
import { resolveColumnKind } from "./resolve-kind.js";
import { findPkColumn } from "./pk.js";
import { isAutoManagedTimestampColumn, type TableDef } from "./table.js";
import { logger } from "../db/logger.js";
import { findRowLabelColumns } from "../rows/row-label.js";
import { getColumnEnumValues } from "./table-value-zod.js";
import { defaultColumnLabel } from "@sapporta/shared";
import {
  hrefPlaceholderColumns,
  type ChildSchema,
  type ColumnSchema,
  type NavLink,
  type TableSchema,
} from "@sapporta/shared/contracts";

const log = logger.child({ module: "schema" });

/**
 * Projects loaded `TableDef` values into browser-safe table metadata.
 *
 * The metadata endpoint is the frontend's table model. It contains public SQL
 * names, presence facts, references, select options, semantic `kind`, and
 * presentation hints. It does not contain Drizzle objects, server validators,
 * auth authority, or database access.
 *
 * Every emitted column has a resolved `kind`. Column factories provide an
 * explicit kind and raw Drizzle columns use `resolveColumnKind()` as a supported
 * fallback. The shared wire schema requires this field, and the frontend parses
 * the response before metadata-driven controls decode drafts.
 *
 * Used by the `/meta/tables` API and available for direct use in tests.
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

    const columns: ColumnSchema[] = config.columns.map((col) => {
      const columnMeta = schema.meta.columns[col.name];
      const kind = resolveColumnKind(schema, col.name);
      if (!kind) {
        throw new Error(
          `Schema extraction could not resolve kind for ${schema.sqlName}.${col.name}.`,
        );
      }
      const selectOptions = getColumnEnumValues(col);
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
        select: selectOptions ? { options: [...selectOptions] } : null,
        // Factories stamp `kind` in `meta.columns`; hand-declared Drizzle
        // columns derive it from the normalized dataType. This guarantees
        // every extracted column has a `kind`, so downstream consumers
        // (UI display, operator applicability, parse) read a single field.
        kind,
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
        apiWritable: columnMeta?.apiWritable,
        visuallyHidden: columnMeta?.visuallyHidden,
      };

      // Auto-synthesize a drill-up link for FK columns. Consumers (table &
      // report grids) render cell navigation uniformly from `links` — the FK
      // case is just a default, not a parallel mechanism. Author-declared
      // column links follow the synthesized drill-up so the FK cell's
      // primary link stays the reference it displays.
      const fk = colSchema.foreignKey;
      const fkLinks: NavLink[] = fk
        ? [
            {
              kind: "table",
              table: fk.table,
              bind: { [fk.column]: col.name },
              icon: "drill-up",
            },
          ]
        : [];
      const declaredLinks = columnMeta?.links ?? [];
      for (const link of declaredLinks) {
        validateLink(schema, byName, link, `column "${col.name}"`);
      }
      const links = dedupeLinks([...fkLinks, ...declaredLinks]);
      if (links.length > 0) {
        colSchema.links = links;
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

    // Row-level links: author-declared links first (they carry the table's
    // domain intent), then drill-into links synthesized from children. One
    // synthesized link per child; bind maps the child's FK column → this
    // table's PK on the row.
    const declaredRowLinks = schema.meta.rowLinks;
    for (const link of declaredRowLinks) {
      validateLink(schema, byName, link, "rowLinks");
    }
    const childRowLinks: NavLink[] = children.map((child) => ({
      kind: "table",
      table: child.table,
      bind: { [child.foreignKey]: parentPkName },
      label: `Open ${child.label}`,
      icon: "drill-into",
    }));
    const rowLinks = dedupeLinks([...declaredRowLinks, ...childRowLinks]);

    return {
      name: schema.sqlName,
      label: schema.meta.label,
      immutable: schema.meta.immutable,
      columns,
      children,
      ...(rowLinks.length > 0 ? { rowLinks } : {}),
      rowLabelColumns,
      searchable: schema.meta.search !== false,
    };
  });
}

/**
 * Rejects declared links that read columns that don't exist — bind sources
 * and url `{column}` placeholders both resolve against the current row, so
 * an unknown name would silently produce dead links in every grid; schema
 * extraction fails instead. `where` names the declaration site for the
 * error message.
 */
function validateLink(
  schema: TableDef,
  byName: ReadonlyMap<string, TableDef>,
  link: NavLink,
  where: string,
): void {
  const sourceColumns = new Set(
    getTableConfig(schema.drizzle).columns.map((c) => c.name),
  );
  const readColumns = Object.values(link.bind ?? {});
  if (link.kind === "url") {
    readColumns.push(...hrefPlaceholderColumns(link.href));
  }
  for (const sourceColumn of readColumns) {
    if (!sourceColumns.has(sourceColumn)) {
      throw new Error(
        `Table "${schema.sqlName}" ${where} declares a link reading ` +
          `unknown source column "${sourceColumn}".`,
      );
    }
  }

  if (link.kind !== "table") return;
  const target = byName.get(link.table);
  if (!target) {
    throw new Error(
      `Table "${schema.sqlName}" ${where} declares a link to unknown ` +
        `table "${link.table}".`,
    );
  }
  const targetColumns = new Set(
    getTableConfig(target.drizzle).columns.map((c) => c.name),
  );
  for (const targetColumn of Object.keys(link.bind ?? {})) {
    if (!targetColumns.has(targetColumn)) {
      throw new Error(
        `Table "${schema.sqlName}" ${where} declares a link binding ` +
          `unknown column "${targetColumn}" on table "${link.table}".`,
      );
    }
  }
}

/** Drops links that repeat an identical destination and bind. */
function dedupeLinks(links: readonly NavLink[]): NavLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = JSON.stringify([
      link.kind,
      link.kind === "table"
        ? link.table
        : link.kind === "report"
          ? link.report
          : link.href,
      link.bind ?? {},
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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
