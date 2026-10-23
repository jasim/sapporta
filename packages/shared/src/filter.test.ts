/**
 * Boundary-parse tests — DATA-TYPE-PRINCIPLES.md Part V Layers 1, 2, and 4.
 *
 *   Layer 1: parseFilterValue per ValueKind — strict, no coercion.
 *   Layer 2: operator-applicability matrix — every (kind, operator) pair.
 *   Layer 4: encodeFilters → decodeFilters → parseFilters round-trip.
 *
 * Temporal calendar validity is covered in temporal.test.ts; here we only
 * exercise parseFilterValue's thin wrapping (error propagation, empty→null).
 */

import { describe, expect, it } from "vitest";
import {
  OPERATORS,
  SCALAR_OPS,
  LIST_OPS,
  parseFilterValue,
  checkOperatorApplicable,
  parseFilterForTable,
  parseFilters,
  parseFiltersForTable,
  encodeFilters,
  encodeTypedFilters,
  decodeFilters,
  decodeFilterObject,
  TypedFilterParseError,
  type FilterCondition,
  type FilterTableLike,
  type TypedFilterCondition,
} from "./filter.js";
import { OPERATOR_APPLICABILITY, type ValueKind } from "./value-kind.js";
import { Temporal } from "./temporal.js";

const ALL_KINDS: readonly ValueKind[] = [
  "text",
  "number",
  "boolean",
  "date",
  "timestamp",
];

// ── Layer 1: parseFilterValue per kind ──────────────────────────────────

describe("parseFilterValue — number", () => {
  it("parses a decimal string to a finite number", () => {
    expect(parseFilterValue("number", "25000")).toBe(25000);
    expect(parseFilterValue("number", "0.1")).toBe(0.1);
    expect(parseFilterValue("number", "-42")).toBe(-42);
  });

  it("rejects an empty or blank string, which Number() reads as 0", () => {
    expect(() => parseFilterValue("number", "")).toThrow(TypedFilterParseError);
    expect(() => parseFilterValue("number", " ")).toThrow(
      TypedFilterParseError,
    );
  });

  it("rejects non-numeric text", () => {
    expect(() => parseFilterValue("number", "abc")).toThrow(
      TypedFilterParseError,
    );
    expect(() => parseFilterValue("number", "$95k")).toThrow(
      TypedFilterParseError,
    );
  });

  it("rejects Infinity and NaN", () => {
    expect(() => parseFilterValue("number", "Infinity")).toThrow(
      TypedFilterParseError,
    );
    expect(() => parseFilterValue("number", "-Infinity")).toThrow(
      TypedFilterParseError,
    );
    expect(() => parseFilterValue("number", "NaN")).toThrow(
      TypedFilterParseError,
    );
  });
});

describe("parseFilterValue — boolean", () => {
  it("parses exact `true` and `false`", () => {
    expect(parseFilterValue("boolean", "true")).toBe(true);
    expect(parseFilterValue("boolean", "false")).toBe(false);
  });

  it("rejects anything else — no coercion of yes/no/1/0", () => {
    for (const bad of ["yes", "no", "1", "0", "True", "FALSE", ""]) {
      expect(() => parseFilterValue("boolean", bad)).toThrow(
        TypedFilterParseError,
      );
    }
  });
});

describe("parseFilterValue — text", () => {
  it("passes through strings unchanged, including empty", () => {
    expect(parseFilterValue("text", "hello")).toBe("hello");
    // Empty string is a legitimate text value, distinct from null.
    expect(parseFilterValue("text", "")).toBe("");
  });
});

describe("parseFilterValue — date", () => {
  it("returns a Temporal.PlainDate for valid ISO input", () => {
    const v = parseFilterValue("date", "2024-01-15");
    expect(v).toBeInstanceOf(Temporal.PlainDate);
  });

  it("rejects an empty string", () => {
    expect(() => parseFilterValue("date", "")).toThrow(TypedFilterParseError);
  });

  it("wraps Temporal errors as TypedFilterParseError", () => {
    expect(() => parseFilterValue("date", "2024-02-30")).toThrow(
      TypedFilterParseError,
    );
    expect(() => parseFilterValue("date", "01/15/2024")).toThrow(
      TypedFilterParseError,
    );
  });
});

describe("parseFilterValue — timestamp", () => {
  it("returns a Temporal.Instant for valid ISO input", () => {
    const v = parseFilterValue("timestamp", "2024-01-15T12:00:00Z");
    expect(v).toBeInstanceOf(Temporal.Instant);
  });

  it("rejects an empty string", () => {
    expect(() => parseFilterValue("timestamp", "")).toThrow(
      TypedFilterParseError,
    );
  });

  it("wraps Temporal errors as TypedFilterParseError", () => {
    expect(() => parseFilterValue("timestamp", "2024-01-15T25:00:00Z")).toThrow(
      TypedFilterParseError,
    );
    expect(() => parseFilterValue("timestamp", "not-a-timestamp")).toThrow(
      TypedFilterParseError,
    );
  });
});

// ── Layer 2: operator-applicability matrix (exhaustive) ─────────────────

describe("OPERATOR_APPLICABILITY — every (kind, op) pair", () => {
  for (const kind of ALL_KINDS) {
    for (const op of OPERATORS) {
      const allowed = OPERATOR_APPLICABILITY[kind].includes(op);
      it(`${kind} × ${op} → ${allowed ? "accept" : "reject"}`, () => {
        if (allowed) {
          expect(() => checkOperatorApplicable(kind, op, "col")).not.toThrow();
        } else {
          expect(() => checkOperatorApplicable(kind, op, "col")).toThrow(
            TypedFilterParseError,
          );
        }
      });
    }
  }

  it("pins the intended shape of the matrix (regression guard)", () => {
    // If a kind or op is added, this assertion forces a conscious update.
    expect(OPERATOR_APPLICABILITY).toEqual({
      text: [
        "eq",
        "neq",
        "contains",
        "startswith",
        "endswith",
        "in",
        "nin",
        "is",
      ],
      number: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "is"],
      boolean: ["eq", "neq", "is"],
      date: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "is"],
      timestamp: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "is"],
    });
  });
});

// ── parseFilters — error surfaces ───────────────────────────────────────

describe("parseFilters — kind resolution and error surfaces", () => {
  const resolveKind = (map: Record<string, ValueKind>) => (col: string) =>
    map[col];

  it("threads kind through scalar, list, and null ops", () => {
    const raw: FilterCondition[] = [
      { id: "a", column: "amount", op: "gt", value: "100" },
      { id: "b", column: "status", op: "in", values: ["paid", "void"] },
      { id: "c", column: "notes", op: "is", polarity: "null" },
    ];
    const typed = parseFilters(
      raw,
      resolveKind({ amount: "number", status: "text", notes: "text" }),
    );
    expect(typed[0]).toMatchObject({ kind: "number", value: 100 });
    expect(typed[1]).toMatchObject({
      kind: "text",
      values: ["paid", "void"],
    });
    expect(typed[2]).toMatchObject({ kind: "text", polarity: "null" });
  });

  it("raises unknown_column when resolveKind returns undefined", () => {
    expect(() =>
      parseFilters(
        [{ id: "a", column: "ghost", op: "eq", value: "x" }],
        resolveKind({}),
      ),
    ).toThrow(expect.objectContaining({ code: "unknown_column" }));
  });

  it("raises op_not_applicable for disallowed kind/op pairs", () => {
    expect(() =>
      parseFilters(
        [{ id: "a", column: "n", op: "contains", value: "x" }],
        resolveKind({ n: "number" }),
      ),
    ).toThrow(expect.objectContaining({ code: "op_not_applicable" }));
  });

  it("raises bad_value for malformed typed inputs", () => {
    expect(() =>
      parseFilters(
        [{ id: "a", column: "n", op: "eq", value: "abc" }],
        resolveKind({ n: "number" }),
      ),
    ).toThrow(expect.objectContaining({ code: "bad_value" }));
  });
});

describe("parseFilterForTable / parseFiltersForTable", () => {
  const table: FilterTableLike = {
    columns: [
      { name: "amount", kind: "number" },
      { name: "status", kind: "text" },
      { name: "notes", kind: "text" },
    ],
  };

  it("parses raw scalar, list, and null conditions with table column kinds", () => {
    const typed = parseFiltersForTable(
      [
        { id: "a", column: "amount", op: "gt", value: "100" },
        { id: "b", column: "amount", op: "in", values: ["1", "2"] },
        { id: "c", column: "notes", op: "is", polarity: "notnull" },
      ],
      table,
    );

    expect(typed[0]).toMatchObject({
      id: "a",
      column: "amount",
      op: "gt",
      kind: "number",
      value: 100,
    });
    expect(typed[1]).toMatchObject({
      id: "b",
      column: "amount",
      op: "in",
      kind: "number",
      values: [1, 2],
    });
    expect(typed[2]).toMatchObject({
      id: "c",
      column: "notes",
      op: "is",
      kind: "text",
      polarity: "notnull",
    });
  });

  it("raises typed parse errors for unknown columns and invalid operators", () => {
    expect(() =>
      parseFilterForTable(
        { id: "missing", column: "ghost", op: "eq", value: "x" },
        table,
      ),
    ).toThrow(expect.objectContaining({ code: "unknown_column" }));

    expect(() =>
      parseFilterForTable(
        { id: "bad-op", column: "amount", op: "contains", value: "1" },
        table,
      ),
    ).toThrow(expect.objectContaining({ code: "op_not_applicable" }));
  });
});

// ── Layer 4: URL round-trip (grammar level) ─────────────────────────────

describe("encodeFilters → decodeFilters → parseFilters round-trip", () => {
  const resolveKind = (map: Record<string, ValueKind>) => (col: string) =>
    map[col];

  it("round-trips scalar ops across kinds with typed output", () => {
    const original: FilterCondition[] = [
      { id: "a", column: "amount", op: "gt", value: "100" },
      { id: "b", column: "status", op: "eq", value: "paid" },
      { id: "c", column: "due", op: "lte", value: "2024-12-31" },
    ];
    const params = encodeFilters(original);
    const decoded = decodeFilters(params);
    const typed = parseFilters(
      decoded,
      resolveKind({ amount: "number", status: "text", due: "date" }),
    );
    expect(typed[0]).toMatchObject({ op: "gt", kind: "number", value: 100 });
    expect(typed[1]).toMatchObject({ op: "eq", kind: "text", value: "paid" });
    expect(typed[2]).toMatchObject({ op: "lte", kind: "date" });
    expect((typed[2] as { value: Temporal.PlainDate }).value.toString()).toBe(
      "2024-12-31",
    );
  });

  it("round-trips list ops", () => {
    const original: FilterCondition[] = [
      { id: "a", column: "status", op: "in", values: ["paid", "void"] },
    ];
    const decoded = decodeFilters(encodeFilters(original));
    const typed = parseFilters(decoded, resolveKind({ status: "text" }));
    expect(typed[0]).toMatchObject({
      op: "in",
      kind: "text",
      values: ["paid", "void"],
    });
  });

  it("round-trips null ops with polarity preserved", () => {
    const original: FilterCondition[] = [
      { id: "a", column: "notes", op: "is", polarity: "null" },
      { id: "b", column: "notes", op: "is", polarity: "notnull" },
    ];
    const decoded = decodeFilters(encodeFilters(original));
    const typed = parseFilters(decoded, resolveKind({ notes: "text" }));
    expect(typed[0]).toMatchObject({ op: "is", polarity: "null" });
    expect(typed[1]).toMatchObject({ op: "is", polarity: "notnull" });
  });

  it("decodes repeated values from the lossless HTTP query record", () => {
    expect(
      decodeFilters({
        "filter[status][eq]": ["open", "pending"],
      }),
    ).toMatchObject([
      { column: "status", op: "eq", value: "open" },
      { column: "status", op: "eq", value: "pending" },
    ]);
  });

  it("keeps the fixed and filter namespaces apart", () => {
    const params = encodeFilters(
      [{ column: "archived", op: "eq", value: "false" }],
      "fixed",
    );
    for (const [key, value] of encodeFilters([
      { column: "name", op: "contains", value: "tax" },
    ])) {
      params.append(key, value);
    }
    expect(params.toString()).toBe(
      "fixed%5Barchived%5D%5Beq%5D=false&filter%5Bname%5D%5Bcontains%5D=tax",
    );
    expect(decodeFilters(params, "fixed")).toMatchObject([
      { column: "archived", op: "eq", value: "false" },
    ]);
    expect(decodeFilters(params)).toMatchObject([
      { column: "name", op: "contains", value: "tax" },
    ]);
    expect(() =>
      decodeFilters({ "fixed[archived]": "false" }, "fixed"),
    ).toThrow(/fixed\[col\]\[op\]=value/);
  });

  it("preserves wildcard characters through URL encoding (contains)", () => {
    // User-supplied `%` must survive the URL round-trip as a literal — the
    // LIKE-escape step happens downstream in buildFilterSql.
    const original: FilterCondition[] = [
      { id: "a", column: "name", op: "contains", value: "50%_off" },
    ];
    const decoded = decodeFilters(encodeFilters(original));
    expect(decoded[0]).toMatchObject({
      op: "contains",
      value: "50%_off",
    });
  });

  it("encodes typed conditions through the explicit edge adapter", () => {
    const original: TypedFilterCondition[] = [
      { id: "a", column: "amount", op: "gt", kind: "number", value: 100 },
      {
        id: "b",
        column: "due",
        op: "lte",
        kind: "date",
        value: new Temporal.PlainDate(2024, 12, 31),
      },
    ];

    expect(decodeFilters(encodeTypedFilters(original))).toMatchObject([
      { column: "amount", op: "gt", value: "100" },
      { column: "due", op: "lte", value: "2024-12-31" },
    ]);
  });
});

describe("decodeFilterObject", () => {
  it("decodes each operator family and encodes to the wire format", () => {
    const conds = decodeFilterObject({
      amount: { gte: 100, lt: "500" },
      status: { nin: ["void", "draft"] },
      paid: { eq: true },
      note: { is: null },
      due: { is: "notnull" },
    });
    expect(conds).toEqual([
      { column: "amount", op: "gte", value: "100" },
      { column: "amount", op: "lt", value: "500" },
      { column: "status", op: "nin", values: ["void", "draft"] },
      { column: "paid", op: "eq", value: "true" },
      { column: "note", op: "is", polarity: "null" },
      { column: "due", op: "is", polarity: "notnull" },
    ]);
    expect(
      decodeFilters(encodeFilters(conds)).map(({ id: _, ...c }) => c),
    ).toEqual(conds);
  });

  it.each([
    ["a non-object", ["x"], "unknown_filter_shape"],
    ["a non-object clause", { amount: 5 }, "unknown_filter_shape"],
    ["an unknown operator", { amount: { gtee: 1 } }, "unknown_op"],
    ["an array on a scalar op", { amount: { eq: [1, 2] } }, "bad_value"],
    ["null on a scalar op", { note: { eq: null } }, "bad_value"],
    ["an empty list", { status: { in: [] } }, "bad_value"],
    ["a nested array", { status: { in: [["a"]] } }, "bad_value"],
    ["a bad is value", { note: { is: true } }, "bad_value"],
    ["an empty list item", { status: { in: ["a", ""] } }, "bad_value"],
  ])("rejects %s", (_label, where, code) => {
    expect(() => decodeFilterObject(where)).toThrow(
      expect.objectContaining({ name: "FilterParseError", code }),
    );
  });
});

describe("encodeFilters", () => {
  it.each([
    ["a column with ]", "a]b"],
    ["an empty column", ""],
  ])("rejects %s, which the key cannot carry", (_label, column) => {
    expect(() => encodeFilters([{ column, op: "eq", value: "1" }])).toThrow(
      expect.objectContaining({
        name: "FilterParseError",
        code: "unknown_filter_shape",
      }),
    );
  });

  it("rejects an empty list, which the decoder would reject", () => {
    expect(() =>
      encodeFilters([{ column: "status", op: "in", values: [] }]),
    ).toThrow(
      expect.objectContaining({ name: "FilterParseError", code: "bad_value" }),
    );
  });

  it("writes number list items as strings", () => {
    expect(
      encodeFilters([{ column: "id", op: "in", values: [1, 2] }]).get(
        "filter[id][in]",
      ),
    ).toBe("1,2");
  });

  it("rejects an empty list item, which the wire format cannot carry", () => {
    expect(() =>
      encodeFilters([{ column: "status", op: "nin", values: ["a", ""] }]),
    ).toThrow(
      expect.objectContaining({ name: "FilterParseError", code: "bad_value" }),
    );
  });

  it("escapes commas and backslashes in list items and decodes them back", () => {
    const values = ["Net 30, EOM", "C:\\temp", "a\\,b", ",", "\\"];
    const params = encodeFilters([{ column: "terms", op: "in", values }]);
    expect(params.get("filter[terms][in]")).toBe(
      "Net 30\\, EOM,C:\\\\temp,a\\\\\\,b,\\,,\\\\",
    );
    expect(decodeFilters(params)).toMatchObject([
      { column: "terms", op: "in", values },
    ]);
  });
});

describe("decodeFilters list escapes", () => {
  it.each([
    ["a backslash before another character", "a\\b"],
    ["a trailing backslash", "a\\"],
  ])("rejects %s", (_label, raw) => {
    expect(() =>
      decodeFilters(new URLSearchParams({ "filter[terms][in]": raw })),
    ).toThrow(
      expect.objectContaining({ name: "FilterParseError", code: "bad_value" }),
    );
  });

  it("reads an unescaped comma as a separator", () => {
    expect(
      decodeFilters(new URLSearchParams({ "filter[terms][in]": "a,b" })),
    ).toMatchObject([{ values: ["a", "b"] }]);
  });
});

// Static sanity: SCALAR_OPS + LIST_OPS cover everything but NULL_OPS.
describe("operator vocabulary shape", () => {
  it("OPERATORS = scalar ∪ list ∪ null, disjoint and complete", () => {
    const scalar = new Set<string>(SCALAR_OPS);
    const list = new Set<string>(LIST_OPS);
    for (const op of OPERATORS) {
      const inScalar = scalar.has(op);
      const inList = list.has(op);
      const inNull = op === "is";
      // Each op is in exactly one bucket.
      expect(Number(inScalar) + Number(inList) + Number(inNull)).toBe(1);
    }
  });
});
