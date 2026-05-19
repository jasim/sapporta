import { describe, expect, test } from "vitest";
import { custom, parsePlainDate, relative } from "@sapporta/shared";
import {
  buildExecuteReportParams,
  hasRelativeDateRangeInFormValues,
  inflateReportFormValues,
  serializeReportFormValues,
  snapshotReportFormValues,
  type FlatReportParams,
} from "./report-form-values";
import type { ReportParam } from "@sapporta/shared/contracts";
const params: ReportParam[] = [
  { name: "branch_id", type: "integer", required: false },
  { name: "period", type: "daterange", required: false },
  { name: "query", type: "string", required: false },
];

describe("report-form-values", () => {
  test("inflate/serialize round-trip keeps scalar and daterange params aligned", () => {
    const flat: FlatReportParams = {
      branch_id: "42",
      period_from: "2024-01-01",
      period_to: "2024-01-31",
      query: "cash",
    };

    const values = inflateReportFormValues(params, flat);

    expect(serializeReportFormValues(params, values)).toEqual(flat);
  });

  test("buildExecuteReportParams parses numeric scalars and flattens dateranges", () => {
    const values = {
      branch_id: "42",
      period: custom(parsePlainDate("2024-01-01"), parsePlainDate("2024-01-31")),
      query: "cash",
    };

    expect(buildExecuteReportParams(params, values)).toEqual({
      branch_id: 42,
      period_from: "2024-01-01",
      period_to: "2024-01-31",
      query: "cash",
    });
  });

  test("snapshotReportFormValues freezes relative dateranges", () => {
    const values = {
      branch_id: "42",
      period: relative("30d"),
      query: "cash",
    };

    expect(hasRelativeDateRangeInFormValues(params, values)).toBe(true);
    expect(
      snapshotReportFormValues(params, values, parsePlainDate("2025-04-15")),
    ).toEqual({
      branch_id: "42",
      period_from: "2025-03-16",
      period_to: "2025-04-15",
      query: "cash",
    });
  });
});
