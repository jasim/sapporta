import { describe, expect, test } from "vitest";
import {
  buildReportSearchParams,
  parseReportSearchParams,
} from "./report-url";
import type { ReportParam } from "@sapporta/shared/contracts";

describe("report search params", () => {
  const reportParams: ReportParam[] = [
    { name: "branch_id", type: "integer", required: false },
    { name: "period", type: "daterange", required: false },
  ];

  test("buildReportSearchParams preserves flat daterange keys", () => {
    const sp = buildReportSearchParams({
      branch_id: "42",
      period_from: "2024-01-01",
      period_to: "2024-01-31",
      empty: "",
    });

    expect(sp.get("branch_id")).toBe("42");
    expect(sp.get("period_from")).toBe("2024-01-01");
    expect(sp.get("period_to")).toBe("2024-01-31");
    expect(sp.has("empty")).toBe(false);
  });

  test("parseReportSearchParams includes daterange wire keys", () => {
    const sp = new URLSearchParams(
      "branch_id=42&period_from=2024-01-01&period_to=2024-01-31&ignored=1",
    );

    expect(parseReportSearchParams(sp, reportParams)).toEqual({
      branch_id: "42",
      period_from: "2024-01-01",
      period_to: "2024-01-31",
    });
  });

  test("parseReportSearchParams does not invent daterange companion keys for scalar params", () => {
    const sp = new URLSearchParams("branch_id=42&branch_id_from=100");

    expect(parseReportSearchParams(sp, reportParams)).toEqual({
      branch_id: "42",
    });
  });
});
