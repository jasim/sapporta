import { describe, expect, it } from "vitest";
import * as report from "./index";
import type {
  ReportGridFooterLinkContext,
  ReportGridLink,
  ReportGridLinkContext,
  ReportGridLinkResolvers,
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
    expect(report).toHaveProperty("EntitySelectField");
    expect(report).toHaveProperty("buildSearchParams");
    expect(report).toHaveProperty("createSnapshotUrl");

    const link = {
      label: "Open report",
      href: "/reports/sample",
      kind: "route",
    } satisfies ReportGridLink;
    const resolvers = {
      row: {
        row: (_context: ReportGridLinkContext) => [link],
        footer: (_context: ReportGridFooterLinkContext) => [link],
      },
    } satisfies ReportGridLinkResolvers;

    expect(resolvers.row.row).toBeDefined();
    expect(resolvers.row.footer).toBeDefined();
  });

  it("does not export the lower grid runtime adapter layer", () => {
    expect(report).not.toHaveProperty("ReportGrid");
    expect(report).not.toHaveProperty("ReportGridView");
    expect(report).not.toHaveProperty("useReportGridBinding");
    expect(report).not.toHaveProperty("createReportGridSession");
  });
});
