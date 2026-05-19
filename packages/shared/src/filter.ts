/**
 * Filter grammar — the single authority for the wire format, shared by the
 * UI router and the server query parser.
 *
 * Wire format (what the URL carries and what the server parses):
 *
 *     filter[col][op]=value
 *
 * `in`/`nin` pass comma-separated values. `is` carries the literal string
 * "null" or "notnull". Everything else is a single string.
 *
 * `FilterCondition` is a discriminated union on `op`. The type system
 * guarantees the value shape at every call site — no runtime shape guards.
 *
 * `decodeFilters` validates everything grammar-level (key shape, op set,
 * `is` polarity, `in`/`nin` non-empty CSV) and fails with a typed
 * `FilterParseError`. The server wraps those errors into its
 * `QueryParseError`; the server still owns column-existence checks and
 * SQL emission (both of which need schema/drizzle knowledge that can't
 * live in this package).
 */

import {
  Temporal,
  parsePlainDate,
  parseCanonicalInstant,
  formatPlainDate,
  formatCanonicalInstant,
} from "./temporal.js";
import { isOperatorApplicable } from "./value-kind.js";
import type { ValueKind } from "./value-kind.js";

export const SCALAR_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "startswith",
  "endswith",
] as const;
export const LIST_OPS = ["in", "nin"] as const;
export const NULL_OPS = ["is"] as const;
export const OPERATORS = [...SCALAR_OPS, ...LIST_OPS, ...NULL_OPS] as const;

export type ScalarOp = (typeof SCALAR_OPS)[number];
export type ListOp = (typeof LIST_OPS)[number];
export type NullOp = (typeof NULL_OPS)[number];
export type Operator = (typeof OPERATORS)[number];
export type Polarity = "null" | "notnull";

export function isOperator(v: string): v is Operator {
  return (OPERATORS as readonly string[]).includes(v);
}
function isScalarOp(v: string): v is ScalarOp {
  return (SCALAR_OPS as readonly string[]).includes(v);
}
function isListOp(v: string): v is ListOp {
  return (LIST_OPS as readonly string[]).includes(v);
}

/**
 * A column-scoped condition. Three variants, discriminated on `op`:
 *
 *   - Scalar ops (`eq`, `gt`, `contains`, …) carry a single `value: string`.
 *   - List ops (`in`, `nin`) carry `values: string[]`.
 *   - The null-check op (`is`) carries a `polarity`.
 *
 * Ids live only in memory — they are not serialized into the URL.
 */
export type FilterCondition =
  | { id: string; column: string; op: ScalarOp; value: string }
  | { id: string; column: string; op: ListOp; values: string[] }
  | { id: string; column: string; op: NullOp; polarity: Polarity };

/**
 * A condition being authored — same shape as `FilterCondition` minus `id`,
 * which controllers mint on insert. Built as a distributive Omit so the
 * discriminated union is preserved; plain `Omit<FilterCondition, "id">`
 * collapses the union into `{column, op}` (only the shared keys survive)
 * and silently drops `value` / `values` / `polarity`.
 */
export type NewFilterCondition = FilterCondition extends infer T
  ? T extends { id: string }
    ? Omit<T, "id">
    : never
  : never;

/** Wire-format key for a column+op pair: `filter[col][op]`. */
export function wireKey(column: string, op: Operator): string {
  return `filter[${column}][${op}]`;
}

// ── Typed layer ──────────────────────────────────────────────────────────
// After the grammar parse validates shape, a boundary-parse converts raw
// string values into their declared type (number, boolean, Temporal.*).
// Everything past this point carries typed values; the query builder never
// sees strings for numeric comparisons. See docs/DATA-TYPE-PRINCIPLES.md §4.

/**
 * A typed value post-boundary-parse. Dates and timestamps are Temporal
 * objects — the factory (storage layer) serializes back to a canonical
 * TEXT shape when the value is bound to Drizzle.
 */
export type TypedValue =
  | string
  | number
  | boolean
  | Temporal.PlainDate
  | Temporal.Instant
  | null;

/**
 * A column-scoped condition with a typed value. Mirrors `FilterCondition`
 * (the raw form) structurally, but values are TypedValue rather than
 * string, and each condition carries the `kind` it was parsed under so
 * downstream SQL emission can decide serialization without re-looking-up
 * the schema.
 */
export type TypedFilterCondition =
  | { id: string; column: string; op: ScalarOp; kind: ValueKind; value: TypedValue }
  | { id: string; column: string; op: ListOp; kind: ValueKind; values: TypedValue[] }
  | { id: string; column: string; op: NullOp; kind: ValueKind; polarity: Polarity };

/** Typed version of `FilterParseError` failure codes. */
export type TypedFilterParseCode =
  | "bad_value"          // raw string doesn't parse under declared kind
  | "op_not_applicable"  // operator not allowed on column's kind
  | "unknown_column";    // column is not on the target table

/** Thrown by `parseFilters` and `parseFilterValue` on typed-boundary
 *  failures. The server wraps these into `QueryParseError` with the same
 *  code — the codes match `FilterParseError`'s `bad_value` plus a new
 *  `op_not_applicable` for operator/kind mismatch. */
export class TypedFilterParseError extends Error {
  public readonly code: TypedFilterParseCode;
  constructor(code: TypedFilterParseCode, message: string) {
    super(message);
    this.name = "TypedFilterParseError";
    this.code = code;
  }
}

/**
 * Parse a raw URL-string into the typed form for a declared `kind`.
 *
 * Strict: malformed input throws. Coercion (e.g. `"$95k"` → 95000) is
 * NOT performed and never will be — see the "No Coercion" principle.
 *
 * Null/empty semantics: the empty string is treated as `null` for
 * non-text kinds (a user clearing a numeric filter sends `""`). For
 * text, empty string is a legitimate value (distinct from null) and
 * is returned as-is.
 */
export function parseFilterValue(kind: ValueKind, raw: string): TypedValue {
  switch (kind) {
    case "text":
      return raw;
    case "number": {
      if (raw === "") return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new TypedFilterParseError(
          "bad_value",
          `expected a number, got ${JSON.stringify(raw)}`,
        );
      }
      return n;
    }
    case "boolean": {
      if (raw === "true") return true;
      if (raw === "false") return false;
      throw new TypedFilterParseError(
        "bad_value",
        `expected "true" or "false", got ${JSON.stringify(raw)}`,
      );
    }
    case "date": {
      if (raw === "") return null;
      try {
        return parsePlainDate(raw);
      } catch (err) {
        throw new TypedFilterParseError(
          "bad_value",
          `expected ISO date YYYY-MM-DD, got ${JSON.stringify(raw)}: ${(err as Error).message}`,
        );
      }
    }
    case "timestamp": {
      if (raw === "") return null;
      try {
        return parseCanonicalInstant(raw);
      } catch (err) {
        throw new TypedFilterParseError(
          "bad_value",
          `expected ISO timestamp, got ${JSON.stringify(raw)}: ${(err as Error).message}`,
        );
      }
    }
  }
}

/**
 * Assert that `op` is applicable to `kind` or throw. Reads the single
 * operator-applicability matrix; UI and server consult the same table.
 */
export function checkOperatorApplicable(
  kind: ValueKind,
  op: Operator,
  column: string,
): void {
  if (!isOperatorApplicable(kind, op)) {
    throw new TypedFilterParseError(
      "op_not_applicable",
      `operator "${op}" is not applicable to ${kind} column "${column}"`,
    );
  }
}

/**
 * Serialize a TypedValue for binding to a SQLite query. Temporal objects
 * collapse to their canonical TEXT form (the factory's storage dialect);
 * primitives pass through unchanged. Shared by the filter SQL builder and
 * the report engine's param resolver — both bind TypedValues to the same
 * SQLite driver and need identical serialization.
 */
export function serializeTypedValue(v: TypedValue): unknown {
  if (v instanceof Temporal.PlainDate) return formatPlainDate(v);
  if (v instanceof Temporal.Instant) return formatCanonicalInstant(v);
  return v;
}

/**
 * Boundary parse: convert raw filter conditions to typed ones.
 *
 * Caller supplies a `resolveKind` callback — the server resolves it
 * against the Drizzle schema / column-meta; the UI (when it wants typed
 * conditions locally) resolves it against the ColumnSchema from the
 * metadata endpoint. Shared package stays leaf.
 *
 * `resolveKind` returning `undefined` means the column is not on the
 * target table — a caller bug, surfaced as `unknown_column`. Kinds are
 * never inferred here; factories (and the hand-written fallback on the
 * server) are the only places `ValueKind` originates.
 */
export function parseFilters(
  raw: FilterCondition[],
  resolveKind: (column: string) => ValueKind | undefined,
): TypedFilterCondition[] {
  const out: TypedFilterCondition[] = [];
  for (const cond of raw) {
    const kind = resolveKind(cond.column);
    if (!kind) {
      throw new TypedFilterParseError(
        "unknown_column",
        `unknown column "${cond.column}"`,
      );
    }
    checkOperatorApplicable(kind, cond.op, cond.column);
    switch (cond.op) {
      case "in":
      case "nin": {
        const values = cond.values.map((v) => parseFilterValue(kind, v));
        out.push({ id: cond.id, column: cond.column, op: cond.op, kind, values });
        break;
      }
      case "is":
        out.push({
          id: cond.id,
          column: cond.column,
          op: cond.op,
          kind,
          polarity: cond.polarity,
        });
        break;
      default: {
        const value = parseFilterValue(kind, cond.value);
        out.push({ id: cond.id, column: cond.column, op: cond.op, kind, value });
      }
    }
  }
  return out;
}

/** Serialize a condition's value for transmission. */
export function encodeFilterValue(cond: FilterCondition): string {
  switch (cond.op) {
    case "in":
    case "nin":
      return cond.values.join(",");
    case "is":
      return cond.polarity;
    default:
      return cond.value;
  }
}

/**
 * Serialize a list of conditions to `URLSearchParams` in wire format.
 * The same column may appear more than once (the grammar AND-combines them),
 * so we call `append`, not `set`. Ids are intentionally not serialized.
 */
export function encodeFilters(filters: FilterCondition[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const cond of filters) {
    params.append(wireKey(cond.column, cond.op), encodeFilterValue(cond));
  }
  return params;
}

/** Closed taxonomy of grammar-level parse failures. These mirror the
 *  matching codes in the server's `QueryParseError` so the server can
 *  pass them through without remapping. */
export type FilterParseErrorCode =
  | "unknown_filter_shape"
  | "unknown_op"
  | "bad_value";

/** Thrown by `decodeFilters` on a grammar violation. The UI catches
 *  `Error` at the route boundary; the server rewraps into its
 *  `QueryParseError` so the HTTP handler can turn it into a 400. */
export class FilterParseError extends Error {
  public readonly code: FilterParseErrorCode;
  constructor(code: FilterParseErrorCode, message: string) {
    super(message);
    this.name = "FilterParseError";
    this.code = code;
  }
}

const FILTER_PREFIX = "filter[";
const FILTER_KEY_RE = /^filter\[([^\]]+)\]\[([^\]]+)\]$/;

/**
 * Parse filter entries out of a query-string source into a list of
 * conditions. Non-filter params are silently ignored. Any key that begins
 * with `filter[` but doesn't match the two-bracket shape is a grammar
 * error, not a silent skip — typos shouldn't widen the result set.
 *
 * Accepts either `URLSearchParams` (browser side) or a plain record of the
 * shape Hono returns from `c.req.query()` (server side). The two are the
 * only query-string representations the grammar ever sees.
 */
export function decodeFilters(
  source: URLSearchParams | Record<string, string>,
): FilterCondition[] {
  const entries: Iterable<[string, string]> =
    source instanceof URLSearchParams ? source : Object.entries(source);
  const out: FilterCondition[] = [];
  for (const [key, value] of entries) {
    if (!key.startsWith(FILTER_PREFIX)) continue;
    const m = FILTER_KEY_RE.exec(key);
    if (!m) {
      throw new FilterParseError(
        "unknown_filter_shape",
        `Filter ${JSON.stringify(key)} must use filter[col][op]=value syntax`,
      );
    }
    const [, column, op] = m;
    if (!isOperator(op)) {
      throw new FilterParseError(
        "unknown_op",
        `Unknown filter operator "${op}" on column "${column}"`,
      );
    }
    out.push(parseCondition(column, op, value));
  }
  return out;
}

function parseCondition(
  column: string,
  op: Operator,
  raw: string,
): FilterCondition {
  const id = mintFilterId(column, op);
  if (isListOp(op)) {
    if (raw === "") {
      throw new FilterParseError(
        "bad_value",
        `filter[${column}][${op}] requires at least one value`,
      );
    }
    const values = raw.split(",");
    if (values.some((v) => v === "")) {
      throw new FilterParseError(
        "bad_value",
        `filter[${column}][${op}] has an empty item in CSV list`,
      );
    }
    return { id, column, op, values };
  }
  if (op === "is") {
    if (raw !== "null" && raw !== "notnull") {
      throw new FilterParseError(
        "bad_value",
        `filter[${column}][is] must be "null" or "notnull", got ${JSON.stringify(raw)}`,
      );
    }
    return { id, column, op, polarity: raw };
  }
  if (isScalarOp(op)) return { id, column, op, value: raw };
  // Unreachable: isOperator narrowed op to ScalarOp | ListOp | NullOp, and
  // we've handled the latter two. Present only so the return type holds.
  throw new FilterParseError("unknown_op", `Unhandled operator: ${op}`);
}

// ── Identity & equality ──────────────────────────────────────────────────

let nextFilterId = 0;

/** Mint a fresh in-memory id for a FilterCondition. The format is opaque;
 *  callers never parse it. Unique per process. */
export function mintFilterId(column: string, op: string): string {
  nextFilterId += 1;
  return `fc_${nextFilterId}_${column}_${op}`;
}

/** Deep equality on the `column + op + value` content of a condition. Ids
 *  are ignored — they are not stable across a URL round-trip. */
export function conditionContentEqual(
  a: FilterCondition,
  b: FilterCondition,
): boolean {
  if (a.column !== b.column || a.op !== b.op) return false;
  // The shared op discriminator narrows `a`; `b` has the same runtime
  // variant but TS can't prove it — cast once.
  switch (a.op) {
    case "in":
    case "nin": {
      const bv = (b as typeof a).values;
      return (
        a.values.length === bv.length && a.values.every((v, i) => v === bv[i])
      );
    }
    case "is":
      return a.polarity === (b as typeof a).polarity;
    default:
      return a.value === (b as typeof a).value;
  }
}

/** List-order-sensitive equality. The URL is a sequence; list-position is
 *  what we push back to the URL. */
export function filtersEqual(
  a: FilterCondition[],
  b: FilterCondition[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((ca, i) => conditionContentEqual(ca, b[i]));
}

// ── Construction helpers ─────────────────────────────────────────────────

/** Convenience: build a scalar equality condition, id-minted. */
export function eqCondition(column: string, value: string): FilterCondition {
  return { id: mintFilterId(column, "eq"), column, op: "eq", value };
}

/**
 * Accept either a ready-made condition list or the convenience shape
 * `{ column: value }` of scalar equality filters; return a normalized list.
 */
export function normalizeFilters(
  init: Record<string, string> | FilterCondition[] | undefined,
): FilterCondition[] {
  if (!init) return [];
  if (Array.isArray(init)) return init;
  return Object.entries(init).map(([column, value]) => eqCondition(column, value));
}
