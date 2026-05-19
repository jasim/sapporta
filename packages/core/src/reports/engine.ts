import type {
  ColumnSchema,
  ReportFooterRow,
  ReportLink,
  ReportOutputNode,
  ReportParam,
  ReportResult,
} from "@sapporta/shared/contracts";
import { extractBindVariables, buildPositionalQuery } from "./sql-bind.js";
import { parseFilterValue, serializeTypedValue } from "@sapporta/shared/filter";
import type { ValueKind } from "@sapporta/shared/value-kind";
import {
  formatPlainDate,
  parseDateRange,
  resolveDateRange,
  Temporal,
  type DateRangeState,
} from "@sapporta/shared";

// Re-export for existing consumers (check.ts, tests)
export { extractBindVariables, buildPositionalQuery } from "./sql-bind.js";

/**
 * Minimal SQL client interface for the report engine.
 * Only `unsafe()` is needed — the engine doesn't manage connections or
 * transactions. This is intentionally narrower than the full SqlClient,
 * so the engine stays decoupled from CLI concerns and can be tested with
 * a simple adapter (e.g., createReportSqlClient() from sqlite-sql-client.ts).
 *
 * Parameters use ? positional binding (SQLite convention). The caller must
 * convert $name variables to ? placeholders via buildPositionalQuery()
 * before passing the query to this client.
 */
export interface ReportSqlClient {
  unsafe: (
    query: string,
    params?: unknown[],
  ) => Promise<Record<string, unknown>[]>;
}

import type {
  ReportDefinition,
  ReportTreeNode,
  ReportSource,
  ReportSort,
} from "./report.js";

/**
 * Internal engine type — extends ReportOutputNode with the full SQL row.
 *
 * Created during tree execution (assembleOutputNode), threaded through
 * transforms and rollups, then stripped by applyDisplayFunctions before
 * the result leaves the engine. Code outside engine.ts never sees this type.
 */
type EngineNode = ReportOutputNode & { __rawRow: Record<string, unknown> };

type TreeNodeResult = { nodes: EngineNode[]; footerRows: ReportFooterRow[] };

/**
 * Session-level context threaded through recursive tree execution.
 *
 * These values are constant for the entire execution of a report — they
 * don't change as the engine recurses into child tree nodes. Bundling them
 * into a named type reduces executeTreeNode's parameter count and makes
 * the distinction between session state and per-node state explicit.
 */
type TreeContext = {
  sql: ReportSqlClient;
  sources: Record<string, ReportSource>;
  params: Record<string, unknown>;
  errors: { path: string; message: string }[];
};

// ---------------------------------------------------------------------------
// Param resolution
// ---------------------------------------------------------------------------

// Map a scalar report `ParamType` to the shared `ValueKind` vocabulary.
// Params and filters answer the same question — "parse this URL string
// into its typed form" — so they share a single boundary parser rather
// than maintaining parallel ad-hoc switches. See
// docs/DATA-TYPE-PRINCIPLES.md §4.
//
// `daterange` is deliberately absent: it's not a scalar and takes a
// separate branch in `resolveParams`.
const SCALAR_PARAM_KIND: Record<
  Exclude<ReportParam["type"], "daterange">,
  ValueKind
> = {
  string: "text",
  integer: "number",
  float: "number",
  date: "date",
};

export function resolveParams(
  paramDefs: ReportParam[],
  userParams: Record<string, unknown>,
  /** Wall-clock "today" used to evaluate relative dateranges. Injected
   *  so tests are deterministic. Defaults to the system's current date. */
  today: Temporal.PlainDate = Temporal.Now.plainDateISO(),
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const def of paramDefs) {
    if (def.type === "daterange") {
      resolveDateRangeParam(def, userParams, today, resolved);
      continue;
    }

    let value = userParams[def.name];

    if (value === undefined || value === null || value === "") {
      if (def.required) {
        throw new Error(`Required parameter "${def.name}" is missing`);
      }
      value = def.default ?? null;
    }

    // String inputs (the common case — HTTP query strings) go through the
    // shared typed-boundary parse and are then serialized to the SQLite
    // dialect. Already-typed defaults (e.g. numeric defaults) pass through.
    if (typeof value === "string") {
      value = serializeTypedValue(
        parseFilterValue(SCALAR_PARAM_KIND[def.type], value),
      );
    }

    resolved[def.name] = value;
  }

  return resolved;
}

/**
 * Expand a `daterange` param into its two SQL bindings (`fromBind`,
 * `toBind`). Reads the three flat URL keys `<name>_relative`,
 * `<name>_from`, `<name>_to` out of `userParams`; falls back to
 * `default` (a `DateRangeState`) and finally to `all_time` when every
 * key is absent. The resolved `Temporal.PlainDate` bounds are
 * serialized to ISO strings; `null` bounds pass through as SQL NULL
 * so reports can use the `$x IS NULL OR col op $x` idiom.
 *
 * The factory (`validateParams`) guarantees `fromBind` and `toBind`
 * are both set and distinct, so the non-null asserts are safe.
 */
function resolveDateRangeParam(
  def: ReportParam,
  userParams: Record<string, unknown>,
  today: Temporal.PlainDate,
  out: Record<string, unknown>,
): void {
  const parsed = parseDateRange(def.name, userParams);
  const state: DateRangeState =
    parsed.type === "all_time" && def.default !== undefined
      ? (def.default as DateRangeState)
      : parsed;

  const { from, to } = resolveDateRange(state, today);
  out[def.fromBind!] = from ? formatPlainDate(from) : null;
  out[def.toBind!] = to ? formatPlainDate(to) : null;
}

// ---------------------------------------------------------------------------
// Bind resolution
// ---------------------------------------------------------------------------

function resolveBinds(
  bind:
    | Record<string, string>
    | ((
        parent: Record<string, unknown>,
        params: Record<string, unknown>,
      ) => Record<string, unknown>)
    | undefined,
  parentRow: Record<string, unknown> | null,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (!bind) return {};

  if (typeof bind === "function") {
    return bind(parentRow ?? {}, params);
  }

  // Map form: { account_id: "$parent.id" }
  const result: Record<string, unknown> = {};
  for (const [key, ref] of Object.entries(bind)) {
    if (typeof ref === "string" && ref.startsWith("$parent.")) {
      const col = ref.slice("$parent.".length);
      result[key] = parentRow?.[col] ?? null;
    } else {
      result[key] = ref;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Numeric coercion
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Source execution
// ---------------------------------------------------------------------------

async function executeSource(
  sql: ReportSqlClient,
  source: ReportSource,
  allValues: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const bindVars = extractBindVariables(source.query);
  const { sql: processedSql, values } = buildPositionalQuery(
    source.query,
    bindVars,
    allValues,
  );

  // Values arrive typed from the driver — REAL columns round-trip as
  // native numbers, INTEGER-boolean columns round-trip as booleans, and
  // so on. The storage-aligned factories guarantee this; the engine does
  // not second-guess with heuristic re-coercion. If a report sees a
  // string where a number should be, the fix is upstream (switch the
  // column to the right factory), not here.
  return sql.unsafe(processedSql, values);
}

// ---------------------------------------------------------------------------
// Output node assembly
// ---------------------------------------------------------------------------

function assembleOutputNode(
  treeNode: ReportTreeNode,
  row: Record<string, unknown>,
): EngineNode {
  const columns: Record<string, unknown> = {};
  for (const col of treeNode.columns) {
    if (col.name in row) {
      columns[col.name] = row[col.name];
    }
  }
  return { levelName: treeNode.levelName, columns, __rawRow: row };
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

function sortNodes<T extends ReportOutputNode>(
  nodes: T[],
  sortSpec: ReportSort[],
): T[] {
  if (sortSpec.length === 0) return nodes;

  return nodes.sort((a, b) => {
    for (const spec of sortSpec) {
      const aVal = a.columns[spec.key] ?? a.rollup?.[spec.key];
      const bVal = b.columns[spec.key] ?? b.rollup?.[spec.key];

      let cmp = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal ?? "").localeCompare(String(bVal ?? ""));
      }

      if (cmp !== 0) {
        return spec.direction === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Child processing — execute children for a single parent row
// ---------------------------------------------------------------------------

/**
 * Process all child tree nodes for a given parent row.
 *
 * For each child definition: check `when` condition, execute the child tree,
 * assign the result (respecting singular vs array mode), and store footer rows.
 * Children are processed in declaration order so that later children can see
 * earlier siblings via `childSiblings`.
 */
async function processChildren(
  ctx: TreeContext,
  treeNode: ReportTreeNode,
  node: EngineNode,
  row: Record<string, unknown>,
  nodePath: string,
): Promise<void> {
  if (!treeNode.children || treeNode.children.length === 0) return;

  node.children = {};
  const childSiblings: Record<
    string,
    ReportOutputNode | ReportOutputNode[] | null
  > = {};

  for (const childDef of treeNode.children) {
    const emptyValue = childDef.singular ? null : [];

    // Check `when` condition — skip child if false
    if (childDef.when && !childDef.when(row)) {
      node.children[childDef.levelName] = emptyValue;
      childSiblings[childDef.levelName] = emptyValue;
      continue;
    }

    let childResult: TreeNodeResult;
    try {
      childResult = await executeTreeNode(
        ctx,
        childDef,
        row,
        node,
        childSiblings,
        `${nodePath}.${childDef.levelName}`,
      );
    } catch (err: any) {
      ctx.errors.push({
        path: `${nodePath}.${childDef.levelName}`,
        message: err.message,
      });
      node.children[childDef.levelName] = emptyValue;
      childSiblings[childDef.levelName] = emptyValue;
      continue;
    }

    if (childDef.singular) {
      const single = childResult.nodes[0] ?? null;
      node.children[childDef.levelName] = single;
      childSiblings[childDef.levelName] = single;
    } else {
      node.children[childDef.levelName] = childResult.nodes;
      childSiblings[childDef.levelName] = childResult.nodes;
    }

    if (!childDef.singular && childResult.footerRows.length > 0) {
      if (!node.childFooterRows) node.childFooterRows = {};
      node.childFooterRows[childDef.levelName] = childResult.footerRows;
    }
  }

  // Compute rollup from children
  if (treeNode.rollup) {
    node.rollup = computeRollup(treeNode.rollup, node.children);
  }
}

// ---------------------------------------------------------------------------
// Rollup computation
// ---------------------------------------------------------------------------

/**
 * Compute rollup values from a node's materialized children.
 *
 * Normalizes children to arrays (singular children become single-element
 * arrays) and calls the rollup function. Warning about undeclared keys
 * is handled by the caller (once per tree level, not per row).
 */
function computeRollup(
  rollupFn: (
    children: Record<string, ReportOutputNode[]>,
  ) => Record<string, unknown>,
  children: Record<string, ReportOutputNode[] | ReportOutputNode | null>,
): Record<string, unknown> {
  const childArrays: Record<string, ReportOutputNode[]> = {};
  for (const [key, val] of Object.entries(children)) {
    if (Array.isArray(val)) {
      childArrays[key] = val;
    } else if (val != null) {
      childArrays[key] = [val];
    } else {
      childArrays[key] = [];
    }
  }
  return rollupFn(childArrays);
}

// ---------------------------------------------------------------------------
// Tree execution
// ---------------------------------------------------------------------------

async function executeTreeNode(
  ctx: TreeContext,
  treeNode: ReportTreeNode,
  parentRow: Record<string, unknown> | null,
  parentOutputNode: ReportOutputNode | null,
  siblingsSoFar: Record<string, ReportOutputNode | ReportOutputNode[] | null>,
  path: string,
): Promise<TreeNodeResult> {
  // 1. Resolve bind values and merge with params
  const bindValues = resolveBinds(treeNode.bind, parentRow, ctx.params);
  const allValues = { ...ctx.params, ...bindValues };

  // 2. Execute source query
  const source = ctx.sources[treeNode.source];
  if (!source) {
    ctx.errors.push({ path, message: `Source "${treeNode.source}" not found` });
    return { nodes: [], footerRows: [] };
  }

  let rows: Record<string, unknown>[];
  try {
    rows = await executeSource(ctx.sql, source, allValues);
  } catch (err: any) {
    ctx.errors.push({
      path,
      message: `Query error on source "${treeNode.source}": ${err.message}`,
    });
    return { nodes: [], footerRows: [] };
  }

  // 3. For each row, assemble output node and process children
  const nodes: EngineNode[] = [];
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const node = assembleOutputNode(treeNode, row);
    await processChildren(ctx, treeNode, node, row, `${path}[${rowIdx}]`);
    nodes.push(node);
  }

  // Warn once per tree level if rollup produces keys not declared in columns[].
  // This is a definition-level warning (the rollup function's output shape
  // doesn't change per row), so we check only the first node that has a rollup.
  if (treeNode.rollup && nodes.length > 0 && nodes[0].rollup) {
    const declaredColNames = new Set(treeNode.columns.map((c) => c.name));
    const undeclaredRollup = Object.keys(nodes[0].rollup).filter(
      (k) => !declaredColNames.has(k),
    );
    if (undeclaredRollup.length > 0) {
      ctx.errors.push({
        path: `${path}.rollup`,
        message:
          `Rollup produces keys not declared in columns[]: ${undeclaredRollup.join(", ")}. ` +
          `The UI will not render these values. Add them to columns[] on the "${treeNode.levelName}" level.`,
      });
    }
  }

  // 4. Run transform if declared
  //
  // Transforms run at every tree level, including the root. Root-level
  // reports (e.g. Net Worth Over Time) use transforms to compute cumulative
  // virtual columns from SQL-sourced deltas.
  //
  // When there is no parent (root level), we provide a synthetic empty
  // context so the TransformContext contract is satisfied without requiring
  // transform authors to handle nulls.
  //
  // rawRows gives transforms access to ALL SQL columns — including those not
  // declared in columns[]. The array is parallel to the nodes array.
  let resultNodes: EngineNode[] = nodes;
  if (treeNode.transform) {
    const rawRows = nodes.map((n) => n.__rawRow);
    const context = parentOutputNode
      ? {
          parent: parentOutputNode,
          siblings: siblingsSoFar,
          params: ctx.params,
          rawRows,
        }
      : {
          parent: { levelName: "__root__" as const, columns: {} },
          siblings: {} as Record<
            string,
            ReportOutputNode | ReportOutputNode[] | null
          >,
          params: ctx.params,
          rawRows,
        };
    const transformed = treeNode.transform(nodes, context);

    // Carry forward __rawRow from the original nodes to the transform's output.
    // Transforms return ReportOutputNode[] (the public type), but the engine
    // needs EngineNode[] for display functions. If a transform returns a new
    // object without __rawRow, copy it from the original node at the same index.
    resultNodes = transformed.map((tNode, i) => {
      if ("__rawRow" in tNode) return tNode as EngineNode;
      const rawRow = i < nodes.length ? nodes[i].__rawRow : {};
      return Object.assign(tNode, { __rawRow: rawRow }) as EngineNode;
    });
  }

  // 5. Sort if declared
  if (treeNode.sort && treeNode.sort.length > 0) {
    resultNodes = sortNodes(resultNodes, treeNode.sort);
  }

  // 6. Compute footer rows (separate from data nodes)
  const footerRows: ReportFooterRow[] = [];
  if (treeNode.footer && treeNode.footer.length > 0) {
    const declaredColNames = new Set(treeNode.columns.map((c) => c.name));
    for (const footer of treeNode.footer) {
      const footerValues = footer.compute(resultNodes);
      footerRows.push({ label: footer.label, columns: footerValues });

      const undeclaredFooter = Object.keys(footerValues).filter(
        (k) => !declaredColNames.has(k),
      );
      if (undeclaredFooter.length > 0) {
        ctx.errors.push({
          path: `${path}.footer["${footer.label}"]`,
          message:
            `Footer "${footer.label}" produces keys not declared in columns[]: ${undeclaredFooter.join(", ")}. ` +
            `The UI will not render these values. Add them to columns[] on the "${treeNode.levelName}" level.`,
        });
      }
    }
  }

  return { nodes: resultNodes, footerRows };
}

// ---------------------------------------------------------------------------
// Level column collection
// ---------------------------------------------------------------------------

/**
 * Walk the tree definition and collect column schemas for each level.
 * Returns a map of levelName → ColumnSchema[].
 */
function collectLevelColumns(
  tree: ReportTreeNode,
): Record<string, ColumnSchema[]> {
  const result: Record<string, ColumnSchema[]> = {};

  function walk(node: ReportTreeNode) {
    result[node.levelName] = node.columns;
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(tree);
  return result;
}

// ---------------------------------------------------------------------------
// Level options collection
// ---------------------------------------------------------------------------

/**
 * Walk the tree definition and collect per-level UI options into a flat map.
 *
 * Mirrors `collectLevelColumns` — both do a pre-order walk of the tree and
 * extract definition-time metadata that the UI needs. The UI receives these
 * as part of ReportResult so it can initialize expand/collapse state without
 * access to the ReportDefinition itself (which lives on the server and
 * contains functions that can't be serialized over JSON).
 *
 * Only levels that have explicitly set options are included in the result;
 * the UI treats absence as "use defaults" (e.g. expanded).
 */
function collectLevelOptions(
  tree: ReportTreeNode,
): Record<string, { defaultCollapsed?: boolean }> {
  const result: Record<string, { defaultCollapsed?: boolean }> = {};

  function walk(node: ReportTreeNode) {
    if (node.defaultCollapsed != null) {
      result[node.levelName] = { defaultCollapsed: node.defaultCollapsed };
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(tree);
  return result;
}

/**
 * Walk the tree and collect per-level `rowLinks` into a flat map.
 * Kept as a peer of collectLevelOptions rather than folded in: levelOptions
 * is scoped to boolean/scalar UI hints (defaultCollapsed) and mixing
 * structured link data there would blur the contract.
 */
function collectLevelLinks(tree: ReportTreeNode): Record<string, ReportLink[]> {
  const result: Record<string, ReportLink[]> = {};

  function walk(node: ReportTreeNode) {
    if (node.rowLinks && node.rowLinks.length > 0) {
      result[node.levelName] = node.rowLinks;
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(tree);
  return result;
}

// ---------------------------------------------------------------------------
// Display function application
// ---------------------------------------------------------------------------

/**
 * Recursively walk the result tree and apply column `display` functions.
 *
 * TIMING: This runs as the LAST step in executeReport, AFTER the entire tree
 * is materialized — transforms, rollups, sorts, and footers are all complete.
 * This ordering is critical: rollup and footer functions see raw numeric
 * column values, not display-formatted strings. Display is purely cosmetic
 * and only affects the final output sent to the UI.
 *
 * For each node, the display function receives a merged object:
 *   { ...rawSqlRow, ...node.columns, ...node.rollup }
 * This means display can reference any SQL column (including undeclared ones),
 * declared column values (possibly modified by transform), and rollup values.
 *
 * Also cleans up the internal __rawRow property from all nodes.
 */
function applyDisplayFunctions(
  nodes: EngineNode[],
  tree: ReportTreeNode,
): void {
  // Build a lookup of column display functions for this level
  const displayFns = new Map<
    string,
    (data: Record<string, unknown>) => string | number | null
  >();
  for (const col of tree.columns) {
    if (col.display) {
      displayFns.set(col.name, col.display);
    }
  }

  for (const node of nodes) {
    // Spread order: raw SQL row first, then declared columns (which may have
    // been modified by transform), then rollup values. Later spreads win on
    // key collisions, so transform modifications take precedence over raw SQL.
    const merged = { ...node.__rawRow, ...node.columns, ...node.rollup };

    // Apply display functions — store the result back into node.columns
    for (const [colName, displayFn] of displayFns) {
      node.columns[colName] = displayFn(merged);
    }

    // Strip __rawRow — transitioning from EngineNode to ReportOutputNode.
    // After this point the node is a plain ReportOutputNode.
    delete (node as ReportOutputNode & { __rawRow?: unknown }).__rawRow;

    // Recurse into children, matching each child group to its tree definition.
    // Children are EngineNodes — they were produced by executeTreeNode which
    // returns EngineNode[], and the children map preserves the concrete type
    // even though its declared type is ReportOutputNode[].
    if (node.children && tree.children) {
      for (const childTree of tree.children) {
        const childData = node.children[childTree.levelName];
        if (Array.isArray(childData)) {
          applyDisplayFunctions(childData as EngineNode[], childTree);
        } else if (childData != null) {
          applyDisplayFunctions([childData] as EngineNode[], childTree);
        }

        // Apply display to child footer rows (e.g. "Closing Balance" on entries)
        const childFooters = node.childFooterRows?.[childTree.levelName];
        if (childFooters) {
          applyFooterDisplayFunctions(childFooters, childTree);
        }
      }
    }
  }
}

/**
 * Apply display functions to footer rows. Footer rows don't have __rawRow
 * (they're synthetic), so the merged data is just the footer's columns.
 */
function applyFooterDisplayFunctions(
  footerRows: ReportFooterRow[],
  tree: ReportTreeNode,
): void {
  const displayFns = new Map<
    string,
    (data: Record<string, unknown>) => string | number | null
  >();
  for (const col of tree.columns) {
    if (col.display) {
      displayFns.set(col.name, col.display);
    }
  }
  if (displayFns.size === 0) return;

  for (const row of footerRows) {
    const merged = { ...row.columns };
    for (const [colName, displayFn] of displayFns) {
      row.columns[colName] = displayFn(merged);
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function executeReport(
  sql: ReportSqlClient,
  definition: ReportDefinition,
  userParams: Record<string, unknown>,
): Promise<ReportResult> {
  const params = resolveParams(definition.params, userParams);

  const ctx: TreeContext = {
    sql,
    sources: definition.sources,
    params,
    errors: [],
  };

  // Execute tree from root — produces EngineNode[] (ReportOutputNode + __rawRow).
  // applyDisplayFunctions consumes __rawRow and deletes it, leaving plain
  // ReportOutputNode objects that are safe to return in the result.
  const { nodes: data, footerRows } = await executeTreeNode(
    ctx,
    definition.tree,
    null, // no parent row for root
    null, // no parent output node for root
    {}, // no siblings for root
    definition.tree.levelName,
  );

  // Apply display functions AFTER the entire tree is materialized.
  // This ordering ensures rollup/footer/transform all see raw numeric
  // values. Display is the last step before returning results.
  // Also cleans up __rawRow from all nodes.
  applyDisplayFunctions(data, definition.tree);
  if (footerRows.length > 0) {
    applyFooterDisplayFunctions(footerRows, definition.tree);
  }

  // Collect static metadata from the tree definition. These are pre-order
  // walks that flatten hierarchical definition-time info into keyed maps
  // for the UI. Both use levelName as the key, which is unique per level.
  const levelColumns = collectLevelColumns(definition.tree);
  const levelOptions = collectLevelOptions(definition.tree);
  const levelLinks = collectLevelLinks(definition.tree);

  // Omit empty optional fields to keep the JSON response clean.
  // The UI treats missing fields as "use defaults".
  return {
    name: definition.name,
    label: definition.label,
    params: definition.params,
    columns: definition.tree.columns,
    levelColumns,
    data,
    ...(Object.keys(levelOptions).length > 0 ? { levelOptions } : {}),
    ...(Object.keys(levelLinks).length > 0 ? { levelLinks } : {}),
    ...(footerRows.length > 0 ? { footerRows } : {}),
    ...(ctx.errors.length > 0 ? { errors: ctx.errors } : {}),
  };
}
