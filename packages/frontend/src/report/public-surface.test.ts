import { describe, expect, it } from "vitest";
import * as report from "./index";
import type {
  ReportCellLink,
  ReportCellLinkContext,
  ReportCellLinkResolvers,
} from "./index";

describe("@sapporta/frontend/report public surface", () => {
  it("exports the blessed GridDataset adapter, link types, and report UI primitives", () => {
    expect(report).toHaveProperty("ReportGridDataset");
    expect(report).toHaveProperty("ReportScreenFrame");
    expect(report).toHaveProperty("ReportToolbar");
    expect(report).toHaveProperty("ReportRunButton");
    expect(report).toHaveProperty("ReportError");
    expect(report).toHaveProperty("ReportSummaryStats");
    expect(report).toHaveProperty("DateRangeField");
    expect(report).toHaveProperty("buildSearchParams");
    expect(report).toHaveProperty("createSnapshotUrl");

    const link = {
      label: "Open report",
      href: "/reports/sample",
      kind: "route",
    } satisfies ReportCellLink;
    const resolvers = {
      summary: {
        cell: {
          total: (_context: ReportCellLinkContext) => [link],
        },
      },
    } satisfies ReportCellLinkResolvers;

    expect(resolvers.summary.cell?.total).toBeDefined();
  });

  it("does not export the lower grid runtime adapter layer", () => {
    expect(report).not.toHaveProperty("ReportGrid");
    expect(report).not.toHaveProperty("ReportGridView");
    expect(report).not.toHaveProperty("useReportGridBinding");
    expect(report).not.toHaveProperty("createReportGridSession");
  });
});
