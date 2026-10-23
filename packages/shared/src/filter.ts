/**
 * Filter grammar — the single authority for the wire format, shared by the
 * UI router and the server query parser.
 *
 * Wire format (what the URL carries and what the server parses):
 *
 *     filter[col][op]=value
 *
 * The same grammar can also be written under a second key prefix, as
 * `fixed[col][op]=value` (see `FilterNamespace`).
 *
 * `in`/`nin` pass comma-separated values. Inside an item, `\,` stands for a
 * comma and `\\` for a backslash. `is` carries the literal string "null" or
 * "notnull". Everything else is a single string.
 *
 * `FilterCondition` is a discriminated union on `op`. The type system
 * guarantees the value shape at every call site — no runtime shape guards.
 *
 * `decodeFilters` validates everything grammar-level (key shape, op set,
 * `is` polarity, an `in`/`nin` list of one or more non-empty items) and
 * fails with a typed `FilterParseError`. `encodeFilters` refuses a column
 * the key cannot carry and a list the decoder would reject, so it never
 * writes a filter that fails to parse. The server wraps those errors into its
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
import type { QueryParamRecord } from "./query-params.js";
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
export const POLARITIES = ["null", "notnull"] as const;
export type Polarity = (typeof POLARITIES)[number];

export function isOperator(v: string): v is Operator {
  return (OPERATORS as readonly string[]).includes(v);
}
function isScalarOp(v: string): v is ScalarOp {
  return (SCALAR_OPS as readonly string[]).includes(v);
}
function isListOp(v: string): v is ListOp {
  return (LIST_OPS as readonly string[]).includes(v);
}
function isPolarity(v: string): v is Polarity {
  return (POLARITIES as readonly string[]).includes(v);
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

export type FilterDraftValue = string | number;

/**
 * A condition without an id, such as one being authored or one about to be
 * encoded. A list item may be a number, such as an account id; the encoder
 * writes it as a string.
 */
export type FilterDraftCondition =
  | { column: string; op: ScalarOp; value: string }
  | { column: string; op: ListOp; values: readonly FilterDraftValue[] }
  | { column: string; op: NullOp; polarity: Polarity };

/**
 * The query-string prefix a list of conditions is written under:
 * `filter[col][op]` or `fixed[col][op]`. The grammar is the same under both
 * prefixes, so one query string can carry two separate lists. An endpoint
 * that reads both lists decides what each one means.
 */
export type FilterNamespace = "filter" | "fixed";

/** One bracketed part of a key: non-empty, with no `]`. */
const FILTER_KEY_SEGMENT = "[^\\]]+";
const FILTER_COLUMN_RE = new RegExp(`^${FILTER_KEY_SEGMENT}$`);

/**
 * Wire-format key for a column+op pair, such as `filter[col][op]`. Throws
 * `FilterParseError` for a column the key cannot carry: an empty name or one
 * containing `]`.
 */
export function wireKey(
  column: string,
  op: Operator,
  namespace: FilterNamespace = "filter",
): string {
  if (!FILTER_COLUMN_RE.test(column)) {
    throw new FilterParseError(
      "unknown_filter_shape",
      `Filter column ${JSON.stringify(column)} must be non-empty and must not contain "]"`,
    );
  }
  return `${namespace}[${column}][${op}]`;
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
  string | number | boolean | Temporal.PlainDate | Temporal.Instant | null;

/**
 * A column-scoped condition with a typed value. Mirrors `FilterCondition`
 * (the raw form) structurally, but values are TypedValue rather than
 * string, and each condition carries the `kind` it was parsed under so
 * downstream SQL emission can decide serialization without re-looking-up
 * the schema.
 */
export type TypedFilterCondition =
  | {
      id: string;
      column: string;
      op: ScalarOp;
      kind: ValueKind;
      value: TypedValue;
    }
  | {
      id: string;
      column: string;
      op: ListOp;
      kind: ValueKind;
      values: TypedValue[];
    }
  | {
      id: string;
      column: string;
      op: NullOp;
      kind: ValueKind;
      polarity: Polarity;
    };

export type FilterTableLike = {
  columns: readonly { name: string; kind: ValueKind }[];
};

type FilterTableInput = {
  columns: readonly { name: string; kind?: ValueKind }[];
};

/** Typed version of `FilterParseError` failure codes. */
export type TypedFilterParseCode =
  | "bad_value" // raw string doesn't parse under declared kind
  | "op_not_applicable" // operator not allowed on column's kind
  | "unknown_column"; // column is not on the target table

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
 * The empty string is a value only for text, where it matches empty text.
 * For every other kind it is a `bad_value`: a missing value is matched with
 * the `is` operator, never with an empty comparison value.
 */
export function parseFilterValue(kind: ValueKind, raw: string): TypedValue {
  switch (kind) {
    case "text":
      return raw;
    case "number": {
      // `Number("")` and `Number(" ")` are 0, so a blank value is
      // rejected before it is converted.
      if (raw.trim() === "") {
        throw new TypedFilterParseError(
          "bad_value",
          `expected a number, got ${JSON.stringify(raw)}; use the is operator to match a missing value`,
        );
      }
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

export function encodeTypedValue(v: TypedValue): string {
  const serialized = serializeTypedValue(v);
  return serialized == null ? "" : String(serialized);
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
        out.push({
          id: cond.id,
          column: cond.column,
          op: cond.op,
          kind,
          values,
        });
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
        out.push({
          id: cond.id,
          column: cond.column,
          op: cond.op,
          kind,
          value,
        });
      }
    }
  }
  return out;
}

export function parseFilterForTable(
  filter: FilterCondition,
  table: FilterTableLike,
): TypedFilterCondition;
export function parseFilterForTable(
  filter: FilterCondition,
  table: FilterTableInput,
): TypedFilterCondition;
export function parseFilterForTable(
  filter: FilterCondition,
  table: FilterTableInput,
): TypedFilterCondition {
  const [typed] = parseFilters(
    [filter],
    (column) =>
      table.columns.find((candidate) => candidate.name === column)?.kind,
  );
  return typed;
}

export function parseFiltersForTable(
  filters: readonly FilterCondition[],
  table: FilterTableLike,
): TypedFilterCondition[];
export function parseFiltersForTable(
  filters: readonly FilterCondition[],
  table: FilterTableInput,
): TypedFilterCondition[];
export function parseFiltersForTable(
  filters: readonly FilterCondition[],
  table: FilterTableInput,
): TypedFilterCondition[] {
  return filters.map((filter) => parseFilterForTable(filter, table));
}

export function encodeTypedCondition(
  cond: TypedFilterCondition,
): FilterCondition {
  switch (cond.op) {
    case "in":
    case "nin":
      return {
        id: cond.id,
        column: cond.column,
        op: cond.op,
        values: cond.values.map(encodeTypedValue),
      };
    case "is":
      return {
        id: cond.id,
        column: cond.column,
        op: cond.op,
        polarity: cond.polarity,
      };
    default:
      return {
        id: cond.id,
        column: cond.column,
        op: cond.op,
        value: encodeTypedValue(cond.value),
      };
  }
}

/**
 * Serialize a condition's value for transmission. An `in`/`nin` item is
 * written as a string, with its commas and backslashes escaped as `\,` and
 * `\\`. Throws `FilterParseError` for an empty list or an empty item, which
 * `decodeFilters` would reject.
 */
export function encodeFilterValue(cond: FilterDraftCondition): string {
  switch (cond.op) {
    case "in":
    case "nin":
      checkListValues(`Filter ${cond.column}.${cond.op}`, cond.values);
      return cond.values
        .map((item) => String(item).replace(/[\\,]/g, (char) => `\\${char}`))
        .join(",");
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
export function encodeFilters(
  filters: readonly FilterDraftCondition[],
  namespace: FilterNamespace = "filter",
): URLSearchParams {
  const params = new URLSearchParams();
  for (const cond of filters) {
    params.append(
      wireKey(cond.column, cond.op, namespace),
      encodeFilterValue(cond),
    );
  }
  return params;
}

/** Edge adapter for URL/API calls that already carry typed conditions. */
export function encodeTypedFilters(
  filters: readonly TypedFilterCondition[],
  namespace: FilterNamespace = "filter",
): URLSearchParams {
  return encodeFilters(filters.map(encodeTypedCondition), namespace);
}

/** Closed taxonomy of grammar-level parse failures. These mirror the
 *  matching codes in the server's `QueryParseError` so the server can
 *  pass them through without remapping. */
export type FilterParseErrorCode =
  "unknown_filter_shape" | "unknown_op" | "bad_value";

/** Thrown on a grammar violation: by `decodeFilters` and `decodeFilterObject`
 *  on input, and by `wireKey` and `encodeFilterValue` for a filter the wire
 *  format cannot carry. The UI catches `Error` at the route boundary; the
 *  server rewraps into its `QueryParseError` so the HTTP handler can turn it
 *  into a 400. */
export class FilterParseError extends Error {
  public readonly code: FilterParseErrorCode;
  constructor(code: FilterParseErrorCode, message: string) {
    super(message);
    this.name = "FilterParseError";
    this.code = code;
  }
}

const FILTER_KEY_RE: Readonly<Record<FilterNamespace, RegExp>> = {
  filter: new RegExp(
    `^filter\\[(${FILTER_KEY_SEGMENT})\\]\\[(${FILTER_KEY_SEGMENT})\\]$`,
  ),
  fixed: new RegExp(
    `^fixed\\[(${FILTER_KEY_SEGMENT})\\]\\[(${FILTER_KEY_SEGMENT})\\]$`,
  ),
};

/**
 * Parse filter entries out of a query-string source into a list of
 * conditions. Only keys in `namespace` are read; other params are silently
 * ignored. Any key that begins with `filter[` (or `fixed[`) but doesn't match
 * the two-bracket shape is a grammar error, not a silent skip — typos
 * shouldn't widen the result set.
 *
 * Accepts either `URLSearchParams` (browser side) or the lossless query
 * record used at the server boundary. Repeated record values are decoded as
 * separate conditions in their original order.
 */
export function decodeFilters(
  source: URLSearchParams | Readonly<QueryParamRecord>,
  namespace: FilterNamespace = "filter",
): FilterCondition[] {
  const prefix = `${namespace}[`;
  const out: FilterCondition[] = [];
  for (const [key, value] of filterQueryEntries(source, prefix)) {
    if (!key.startsWith(prefix)) continue;
    const m = FILTER_KEY_RE[namespace].exec(key);
    if (!m) {
      throw new FilterParseError(
        "unknown_filter_shape",
        `Filter ${JSON.stringify(key)} must use ${namespace}[col][op]=value syntax`,
      );
    }
    const [, column, op] = m;
    if (!isOperator(op)) {
      throw new FilterParseError(
        "unknown_op",
        `Unknown filter operator "${op}" on column "${column}"`,
      );
    }
    out.push(parseCondition(column, op, value, namespace));
  }
  return out;
}

/**
 * Parse filter conditions written as a JSON object, such as the CLI's
 * `--where` flag:
 *
 *     { "amount": { "gte": 100 }, "status": { "nin": ["void", "draft"] } }
 *
 * Each key is a column and maps to an object of operator → value. Scalar ops
 * take a string, number or boolean. List ops take an array of those, with one
 * or more items and no empty item. `is` takes `null`, `"null"` or
 * `"notnull"`. An array on a scalar op and `null` on any op but `is` are
 * rejected. `encodeFilters` rejects a column name the `filter[col][op]` key
 * cannot carry, and the server checks that each column exists and that each
 * value parses for its column's kind.
 */
export function decodeFilterObject(source: unknown): FilterDraftCondition[] {
  if (!isPlainObject(source)) {
    throw new FilterParseError(
      "unknown_filter_shape",
      "Filters must be an object of columns",
    );
  }
  const out: FilterDraftCondition[] = [];
  for (const [column, clause] of Object.entries(source)) {
    if (!isPlainObject(clause)) {
      throw new FilterParseError(
        "unknown_filter_shape",
        `Filter for ${JSON.stringify(column)} must be an object of operators`,
      );
    }
    for (const [op, value] of Object.entries(clause)) {
      if (!isOperator(op)) {
        throw new FilterParseError(
          "unknown_op",
          `Unknown filter operator "${op}" on column "${column}"`,
        );
      }
      out.push(filterObjectCondition(column, op, value));
    }
  }
  return out;
}

function filterObjectCondition(
  column: string,
  op: Operator,
  value: unknown,
): FilterDraftCondition {
  const at = `Filter ${column}.${op}`;
  if (op === "is") {
    // JSON `null` is this surface's spelling of the "null" polarity.
    const polarity = value === null ? "null" : value;
    if (typeof polarity !== "string" || !isPolarity(polarity)) {
      throw new FilterParseError(
        "bad_value",
        `${at} must be null, "null" or "notnull", got ${JSON.stringify(value)}`,
      );
    }
    return { column, op, polarity };
  }
  if (isListOp(op)) {
    if (!Array.isArray(value)) {
      throw new FilterParseError(
        "bad_value",
        `${at} requires an array of values`,
      );
    }
    const values = value.map((item) => filterObjectValue(at, item));
    checkListValues(at, values);
    return { column, op, values };
  }
  if (isScalarOp(op)) return { column, op, value: filterObjectValue(at, value) };
  // Unreachable: isOperator narrowed op to ScalarOp | ListOp | NullOp, and
  // we've handled the latter two. Present only so the return type holds.
  throw new FilterParseError("unknown_op", `Unhandled operator: ${op}`);
}

function filterObjectValue(at: string, value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (value === null) {
    throw new FilterParseError(
      "bad_value",
      `${at} cannot be null; use { "is": null } to match a missing value`,
    );
  }
  throw new FilterParseError(
    "bad_value",
    `${at} must be a string, number or boolean, got ${JSON.stringify(value)}`,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function* filterQueryEntries(
  source: URLSearchParams | Readonly<QueryParamRecord>,
  prefix: string,
): IterableIterator<[string, string]> {
  if (source instanceof URLSearchParams) {
    yield* source;
    return;
  }

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") {
      yield [key, value];
      continue;
    }
    if (value.length === 0 && key.startsWith(prefix)) {
      throw new FilterParseError(
        "bad_value",
        `Filter ${JSON.stringify(key)} requires at least one value`,
      );
    }
    for (const item of value) yield [key, item];
  }
}

function parseCondition(
  column: string,
  op: Operator,
  raw: string,
  namespace: FilterNamespace,
): FilterCondition {
  const id = mintFilterId(column, op);
  if (isListOp(op)) {
    // An empty value splits into one empty item, which `checkListValues`
    // rejects.
    const values = splitListValue(raw, wireKey(column, op, namespace));
    checkListValues(wireKey(column, op, namespace), values);
    return { id, column, op, values };
  }
  if (op === "is") {
    if (!isPolarity(raw)) {
      throw new FilterParseError(
        "bad_value",
        `${wireKey(column, op, namespace)} must be "null" or "notnull", got ${JSON.stringify(raw)}`,
      );
    }
    return { id, column, op, polarity: raw };
  }
  if (isScalarOp(op)) return { id, column, op, value: raw };
  // Unreachable: isOperator narrowed op to ScalarOp | ListOp | NullOp, and
  // we've handled the latter two. Present only so the return type holds.
  throw new FilterParseError("unknown_op", `Unhandled operator: ${op}`);
}

/**
 * Split an `in`/`nin` value on its unescaped commas, turning `\,` back into a
 * comma and `\\` into a backslash. A backslash before any other character, or
 * at the end, is a `bad_value`.
 */
function splitListValue(raw: string, key: string): string[] {
  const items: string[] = [];
  let item = "";
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === ",") {
      items.push(item);
      item = "";
    } else if (char !== "\\") {
      item += char;
    } else if (raw[i + 1] === "," || raw[i + 1] === "\\") {
      item += raw[i + 1];
      i++;
    } else {
      throw new FilterParseError(
        "bad_value",
        `${key} has a "\\" that is not followed by "," or "\\"`,
      );
    }
  }
  items.push(item);
  return items;
}

/**
 * An `in`/`nin` list has one or more items, and no item is empty. The
 * comma-separated value cannot tell an empty list from a list holding one
 * empty item, so neither is allowed, and an empty item is refused in every
 * position so the rule does not depend on the list's length.
 */
function checkListValues(
  at: string,
  values: readonly FilterDraftValue[],
): void {
  if (values.length === 0 || values.some((item) => item === "")) {
    throw new FilterParseError(
      "bad_value",
      `${at} needs one or more items, and no item may be empty`,
    );
  }
}

// ── Identity & equality ──────────────────────────────────────────────────

let nextFilterId = 0;

/** Mint a fresh in-memory id for a FilterCondition. The format is opaque;
 *  callers never parse it. Unique per process. */
export function mintFilterId(column: string, op: string): string {
  nextFilterId += 1;
  return `fc_${nextFilterId}_${column}_${op}`;
}

function resolveColumnKind(table: FilterTableInput, column: string): ValueKind {
  const kind = table.columns.find(
    (candidate) => candidate.name === column,
  )?.kind;
  if (!kind) {
    throw new TypedFilterParseError(
      "unknown_column",
      `unknown column "${column}"`,
    );
  }
  return kind;
}

function parseFilterDraftValue(
  kind: ValueKind,
  value: FilterDraftValue,
): TypedValue {
  if (typeof value === "number") {
    if (kind === "number") return value;
    return parseFilterValue(kind, String(value));
  }
  return parseFilterValue(kind, value);
}

export function materializeTypedFilterCondition(
  draft: FilterDraftCondition,
  table: FilterTableLike,
  id?: string,
): TypedFilterCondition;
export function materializeTypedFilterCondition(
  draft: FilterDraftCondition,
  table: FilterTableInput,
  id?: string,
): TypedFilterCondition;
export function materializeTypedFilterCondition(
  draft: FilterDraftCondition,
  table: FilterTableInput,
  id = mintFilterId(draft.column, draft.op),
): TypedFilterCondition {
  const kind = resolveColumnKind(table, draft.column);
  checkOperatorApplicable(kind, draft.op, draft.column);
  switch (draft.op) {
    case "in":
    case "nin":
      return {
        id,
        column: draft.column,
        op: draft.op,
        kind,
        values: draft.values.map((value) => parseFilterDraftValue(kind, value)),
      };
    case "is":
      return {
        id,
        column: draft.column,
        op: draft.op,
        kind,
        polarity: draft.polarity,
      };
    default:
      return {
        id,
        column: draft.column,
        op: draft.op,
        kind,
        value: parseFilterDraftValue(kind, draft.value),
      };
  }
}

export function updateTypedFilterCondition(
  existing: TypedFilterCondition,
  draft: FilterDraftCondition,
  table: FilterTableLike,
): TypedFilterCondition;
export function updateTypedFilterCondition(
  existing: TypedFilterCondition,
  draft: FilterDraftCondition,
  table: FilterTableInput,
): TypedFilterCondition;
export function updateTypedFilterCondition(
  existing: TypedFilterCondition,
  draft: FilterDraftCondition,
  table: FilterTableInput,
): TypedFilterCondition {
  return materializeTypedFilterCondition(draft, table, existing.id);
}

/** Deep equality on the `column + op + value` content of a condition. Ids
 *  are ignored — they are not stable across a URL round-trip. */
export function conditionContentEqual(
  a: TypedFilterCondition,
  b: TypedFilterCondition,
): boolean {
  if (a.column !== b.column || a.op !== b.op) return false;
  // The shared op discriminator narrows `a`; `b` has the same runtime
  // variant but TS can't prove it — cast once.
  switch (a.op) {
    case "in":
    case "nin": {
      const bv = (b as typeof a).values;
      return (
        a.values.length === bv.length &&
        a.values.every((v, i) => typedValueContentEqual(v, bv[i]))
      );
    }
    case "is":
      return a.polarity === (b as typeof a).polarity;
    default:
      return typedValueContentEqual(a.value, (b as typeof a).value);
  }
}

/** List-order-sensitive equality. The URL is a sequence; list-position is
 *  what we push back to the URL. */
export function filtersEqual(
  a: readonly TypedFilterCondition[],
  b: readonly TypedFilterCondition[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((ca, i) => conditionContentEqual(ca, b[i]));
}

function typedValueContentEqual(a: TypedValue, b: TypedValue): boolean {
  return serializeTypedValue(a) === serializeTypedValue(b);
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
  return Object.entries(init).map(([column, value]) =>
    eqCondition(column, value),
  );
}
