import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import {
  encodeTypedValue,
  materializeTypedFilterCondition,
} from "@sapporta/shared/filter";
import { dateInputConditionValue, dateInputValue } from "./date-filter-value";
import { inferFilterColumnType, opsForColumn } from "./column-catalog";

// Day bounds are resolved on the reader's wall clock, so the host zone is
// pinned rather than inherited. Asia/Kolkata is +05:30 year-round, far enough
// east that a local day starts on the previous UTC day.
const DISPLAY_TIME_ZONE = "Asia/Kolkata";

beforeAll(() => {
  vi.stubEnv("TZ", DISPLAY_TIME_ZONE);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const dateColumn = {
  name: "issued_on",
  label: "Issued on",
  kind: "date",
} satisfies ColumnSchema;

const timestampColumn = {
  name: "created_at",
  label: "Created at",
  kind: "timestamp",
} satisfies ColumnSchema;

describe("date filter values on a date column", () => {
  it("passes calendar dates through untouched in both directions", () => {
    expect(dateInputValue(dateColumn, "2026-08-24")).toBe("2026-08-24");
    expect(dateInputConditionValue(dateColumn, "gte", "2026-08-24")).toBe(
      "2026-08-24",
    );
  });
});

describe("date filter values on a timestamp column", () => {
  it("shows the local day the stored instant falls on", () => {
    expect(dateInputValue(timestampColumn, "2026-08-23T20:30:00Z")).toBe(
      "2026-08-24",
    );
  });

  it("puts each operator's bound on the edge of the day it means", () => {
    const day = "2026-08-24";

    // "on or after the 24th" and "before the 24th" both meet at its start.
    expect(dateInputConditionValue(timestampColumn, "gte", day)).toBe(
      "2026-08-23T18:30:00Z",
    );
    expect(dateInputConditionValue(timestampColumn, "lt", day)).toBe(
      "2026-08-23T18:30:00Z",
    );
    // "on or before the 24th" and "after the 24th" both meet at its end.
    expect(dateInputConditionValue(timestampColumn, "lte", day)).toBe(
      "2026-08-24T18:29:59Z",
    );
    expect(dateInputConditionValue(timestampColumn, "gt", day)).toBe(
      "2026-08-24T18:29:59Z",
    );
  });

  it("clears an emptied control rather than bounding an unnamed day", () => {
    expect(dateInputConditionValue(timestampColumn, "gte", "")).toBe("");
  });

  it("builds a range condition the grammar accepts", () => {
    // A date-only bound used to reach the instant parser as typed and throw
    // `Temporal.Instant requires a time zone offset`, out of a change handler.
    const table = { columns: [timestampColumn] };
    const bound = (op: "gte" | "lte", day: string) =>
      materializeTypedFilterCondition(
        {
          column: timestampColumn.name,
          op,
          value: dateInputConditionValue(timestampColumn, op, day),
        },
        table,
      );

    const boundValue = (op: "gte" | "lte", day: string) => {
      const condition = bound(op, day);
      if (condition.op !== "gte" && condition.op !== "lte") {
        throw new Error(`expected an ordering bound, got ${condition.op}`);
      }
      return encodeTypedValue(condition.value);
    };

    expect(() => bound("gte", "2026-08-24")).not.toThrow();
    expect(boundValue("gte", "2026-08-24")).toBe("2026-08-23T18:30:00Z");
    expect(boundValue("lte", "2026-08-24")).toBe("2026-08-24T18:29:59Z");
  });

  it("round-trips a bound back to the day that produced it", () => {
    const day = "2026-08-24";
    for (const op of ["gte", "lte"] as const) {
      const stored = dateInputConditionValue(timestampColumn, op, day);
      expect(dateInputValue(timestampColumn, stored)).toBe(day);
    }
  });
});

describe("operators offered for temporal columns", () => {
  it("offers a whole-day match on a date column", () => {
    const ops = opsForColumn(dateColumn, inferFilterColumnType(dateColumn));

    expect(ops.map((entry) => entry.key)).toContain("eq");
    expect(ops.map((entry) => entry.key)).toContain("neq");
  });

  it("withholds it on a timestamp column, where a day is a range", () => {
    const ops = opsForColumn(
      timestampColumn,
      inferFilterColumnType(timestampColumn),
    );
    const keys = ops.map((entry) => entry.key);

    expect(keys).not.toContain("eq");
    expect(keys).not.toContain("neq");
    expect(keys).toEqual(
      expect.arrayContaining(["gt", "gte", "lt", "lte", "isnull"]),
    );
  });
});
