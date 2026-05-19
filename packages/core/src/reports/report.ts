// ============================================================================
// REPORT DEFINITION API
// ============================================================================
//
// A Sapporta report is a TypeScript file that default-exports a report definition.
// Reports are declarative: you specify SQL data sources and a tree structure that
// describes how to assemble the query results into hierarchical output.
//
// The engine loads report files from a directory, executes them with user-supplied
// parameters, and returns a tree of output nodes.
//
// QUICK EXAMPLE:
//
//   import { report } from "@sapporta/server/report";
//
//   export default report({
//     name: "my-report",
//     label: "My Report",
//     params: [{ name: "year", type: "integer", required: true, label: "Year" }],
//     sources: {
//       items: { query: "SELECT id, name, amount FROM items WHERE year = $year" },
//     },
//     tree: {
//       source: "items",
//       levelName: "item",
//       columns: [
//         { name: "name", header: "Name" },
//         { name: "amount", header: "Amount", kind: "number", displayFormat: "currency" },
//       ],
//     },
//   });
//
// ============================================================================

// ---------------------------------------------------------------------------
// Params — user-supplied inputs that parameterize SQL queries
// ---------------------------------------------------------------------------
//
// Params are declared up front. The UI renders a form for them. The engine
// resolves defaults, validates types, and injects values into SQL queries as
// bind variables.
//
// In SQL sources, reference params with $name syntax:
//   "SELECT * FROM accounts WHERE date <= $as_of_date"

// Param wire shapes (`ParamType`, `ReportParam`) live in
// `@sapporta/shared/contracts` so authors and the wire share one
// definition. Imported below alongside `ReportLink`, `ReportOutputNode`,
// `ReportFooterRow`, `ReportResult`, `SerializedReportStat`.

// ---------------------------------------------------------------------------
// Sources — named SQL queries that provide data for the tree
// ---------------------------------------------------------------------------
//
// Each source is a raw SQL query string. Sources are referenced by tree nodes
// via the `source` field. The same source can be referenced by multiple tree
// nodes (e.g. a "transactions" source used by several child nodes).
//
// Bind variables use $name syntax: $param_name for global params, and $varname
// for bind variables injected by parent tree nodes.
//
// The engine converts $name to positional $1, $2, ... for postgres.js execution.
//
// IMPORTANT: PostgreSQL returns numeric/decimal columns as strings. The engine
// automatically parses these to numbers. Use ::numeric casts in SQL to ensure
// consistent types: COALESCE(SUM(amount::numeric), 0) AS total

export type ReportSource = {
  /** Raw SQL query. Use $name for bind variables (params and parent binds). */
  query: string;
};

// ---------------------------------------------------------------------------
// Columns — which fields from the source row to include in the output
// ---------------------------------------------------------------------------
//
// Each column maps a name from the SQL result to the output node. Only declared
// columns appear in the output — undeclared fields from the SQL row are discarded.
//
// Columns can also be "virtual" — not present in the SQL result but populated
// by a `transform` function. Declare them in columns so the UI knows about them.
//
// Report columns use ColumnSchema (the same type used for table columns).
// Only `name` is required; use `header` for display label, `kind` for the
// semantic value type, and `displayFormat` for presentation hints like
// currency. DB-specific fields (primary, foreignKey, etc.) are optional and
// default to inert values.

import type {
  ColumnSchema,
  ReportFooterRow,
  ReportLink,
  ReportOutputNode,
  ReportParam,
  ReportResult,
  SerializedReportStat,
} from "@sapporta/shared/contracts";

// Re-export wire-shape types so report authors can import everything they
// need from a single place (`@sapporta/server/report`) without reaching into
// `@sapporta/shared/contracts`. `ReportOutputNode` in particular shows up on
// `TransformContext.parent` and `siblings`, so transforms regularly need it.
export type {
  ReportFooterRow,
  ReportLink,
  ReportOutputNode,
  ReportParam,
  ReportResult,
  SerializedReportStat,
};

/**
 * Author DSL for declaring a report column. Identical wire shape to
 * `ColumnSchema`, plus an optional runtime `display` function the engine
 * applies before emitting the response. The function is JSON-stripped at
 * the wire boundary, so what consumers see is a plain `ColumnSchema`.
 *
 * Use this in `ReportTreeNode.columns`. Wire-emitted shapes
 * (`ReportResult.columns`, `ReportResult.levelColumns`) stay typed as
 * `ColumnSchema` because that's what survives serialization.
 */
export type ReportColumn = ColumnSchema & {
  display?: (data: Record<string, unknown>) => string | number | null;
};

// ---------------------------------------------------------------------------
// Sort — ordering of output nodes within a tree level
// ---------------------------------------------------------------------------
//
// Sorting happens after all nodes at a level are assembled (including rollup
// computation). You can sort by column keys or rollup keys.
//
// If no sort is specified, nodes appear in the order returned by the SQL query.

export type ReportSort = {
  /** Column key or rollup key to sort by. */
  key: string;

  /** Sort direction. Default is "asc". */
  direction: "asc" | "desc";
};

// ---------------------------------------------------------------------------
// TransformContext — context available to the transform function
// ---------------------------------------------------------------------------

export type TransformContext = {
  /** The parent output node. Has columns, rollup, and children processed so far. */
  parent: ReportOutputNode;

  /** Children of the parent that were processed before the current child.
   *  Keyed by level name. Contains the fully materialized output.
   *
   *  For singular children: the value is a single ReportOutputNode or null.
   *  For list children: the value is ReportOutputNode[].
   */
  siblings: Record<string, ReportOutputNode | ReportOutputNode[] | null>;

  /** The resolved global params. */
  params: Record<string, unknown>;

  /** Full SQL rows, parallel to the nodes array passed to the transform.
   *  Includes ALL columns from the SQL result, even those not declared in
   *  columns[]. This lets transforms access undeclared SQL columns without
   *  requiring them in the columns[] declaration. */
  rawRows: Record<string, unknown>[];
};

// ---------------------------------------------------------------------------
// Footer — synthetic rows appended after all data nodes at a level
// ---------------------------------------------------------------------------

export type ReportFooter = {
  /** Label for the footer row. Appears as a special column or is used by the UI. */
  label: string;

  /** Compute footer values from the assembled sibling nodes at this level.
   *  The returned Record becomes the footer node's `columns`. */
  compute: (nodes: ReportOutputNode[]) => Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Tree Node — the hierarchical structure of the report
// ---------------------------------------------------------------------------

export type ReportTreeNode = {
  /** Name of the source in the report's `sources` map. */
  source: string;

  /** Name for this tree level. Used as the key in the parent's children map. */
  levelName: string;

  /** Columns to extract from each source row into the output node.
   *  Use `ReportColumn` (= `ColumnSchema` plus a runtime `display` fn)
   *  if you want a column to be display-formatted before emit. */
  columns: ReportColumn[];

  // --- Parent-child binding ---

  /** How to pass values from the parent row into this node's SQL query. */
  bind?:
    | Record<string, string>
    | ((
        parent: Record<string, unknown>,
        params: Record<string, unknown>,
      ) => Record<string, unknown>);

  /** Conditional execution. If returns false, the child is skipped. */
  when?: (parent: Record<string, unknown>) => boolean;

  /** If true, this child produces a single object (or null) instead of an array. */
  singular?: boolean;

  // --- Post-processing ---

  /** Rollup: compute values on a parent node from its materialized children. */
  rollup?: (
    children: Record<string, ReportOutputNode[]>,
  ) => Record<string, unknown>;

  /** Transform: post-process assembled output nodes for this tree level. */
  transform?: (
    nodes: ReportOutputNode[],
    context: TransformContext,
  ) => ReportOutputNode[];

  /** Sort specification. Applied after transform. */
  sort?: ReportSort[];

  /** Footer rows. Computed after all data nodes are finalized. */
  footer?: ReportFooter[];

  /** When true, the UI renders this level's children collapsed by default.
   *
   *  This flag is set on the PARENT level and applies to its children's
   *  visibility. The engine extracts it into `ReportResult.levelOptions`
   *  (keyed by levelName) so the UI can read it without walking the tree
   *  definition. When omitted or false, children start expanded. */
  defaultCollapsed?: boolean;

  /** Child tree nodes. Processed in declaration order for each parent row. */
  children?: ReportTreeNode[];

  /** Row-level navigation entries, rendered as right-click context menu items
   *  in the UI. A link is resolvable for a given row iff every `bind` source
   *  column has a non-null value; unresolvable links are skipped. Footer and
   *  structural rows (opening/closing/subtotal) never render row links. */
  rowLinks?: ReportLink[];
};

// ---------------------------------------------------------------------------
// Report Definition — the top-level structure
// ---------------------------------------------------------------------------

export type ReportDefinition = {
  /** URL-safe identifier. Used in API routes: /api/_reports/:name/execute */
  name: string;

  /** Human-readable title. */
  label: string;

  /** Parameter definitions. */
  params: ReportParam[];

  /** Named SQL data sources. */
  sources: Record<string, ReportSource>;

  /** The tree structure defining how to assemble query results. */
  tree: ReportTreeNode;
};

// Wire output shapes (`ReportFooterRow`, `ReportOutputNode`,
// `ReportResult`, `SerializedReportStat`) live in
// `@sapporta/shared/contracts` so server and client share one definition.

// ---------------------------------------------------------------------------
// report() factory — creates a report definition with type checking
// ---------------------------------------------------------------------------

export function report(def: ReportDefinition): ReportDefinition {
  validateParams(def);
  return def;
}

/** Surface shape errors in the param declaration at definition time so
 *  the report file fails to load instead of producing confusing runtime
 *  errors deep in SQL execution. */
function validateParams(def: ReportDefinition): void {
  const seenBinds = new Set<string>();
  const seenNames = new Set<string>();

  for (const p of def.params) {
    if (seenNames.has(p.name)) {
      throw new Error(`Report "${def.name}": duplicate param name "${p.name}"`);
    }
    seenNames.add(p.name);

    if (p.type === "daterange") {
      if (!p.fromBind || !p.toBind) {
        throw new Error(
          `Report "${def.name}": param "${p.name}" of type "daterange" must declare both fromBind and toBind`,
        );
      }
      if (p.fromBind === p.toBind) {
        throw new Error(
          `Report "${def.name}": param "${p.name}" has fromBind === toBind ("${p.fromBind}") — they must name distinct SQL bindings`,
        );
      }
      for (const b of [p.fromBind, p.toBind]) {
        if (seenBinds.has(b)) {
          throw new Error(
            `Report "${def.name}": SQL bind name "${b}" is declared by more than one param`,
          );
        }
        seenBinds.add(b);
      }
    } else {
      // Scalar params use `name` itself as the SQL bind.
      if (seenBinds.has(p.name)) {
        throw new Error(
          `Report "${def.name}": SQL bind name "${p.name}" is declared by more than one param`,
        );
      }
      seenBinds.add(p.name);
    }
  }
}
