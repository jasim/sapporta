// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GridDataset,
  GridDatasetLevel,
} from "@sapporta/shared/grid-dataset";
import { setDisplayTimeZone } from "@sapporta/grid/column-preset";
import { parseTimeZone } from "@sapporta/shared/temporal";
import { ReportGridDataset } from "./ReportGridDataset";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout, so the width-observing hook would measure 0 and
// flip every test into the narrow cards mode. Pin the wide mode instead.
vi.mock("../../table/page/table-page-mode", () => ({
  useTablePageMode: () => ({ ref: { current: null }, mode: "wide" }),
}));

// An account ledger sent newest first. Two postings share 2026-04-04;
// `sequence` holds the order in time, with the opening row at 0. The
// sequences run to 10 so a text comparison would misorder them.
function ledgerDataset(level: Partial<GridDatasetLevel> = {}): GridDataset {
  const posting = (
    rowKey: string,
    date: string,
    against: string,
    sequence: number,
    kind?: "opening",
  ) => ({
    rowKey,
    levelName: "posting",
    columns: { date, against, sequence },
    ...(kind ? { kind } : {}),
  });
  return {
    name: "account-ledger",
    label: "Account Ledger",
    rootLevel: "posting",
    levels: {
      posting: {
        columns: [
          {
            id: "date",
            label: "Date",
            kind: "date",
            sortBy: ["date", "sequence"],
          },
          { id: "against", label: "Against", kind: "text" },
          {
            id: "sequence",
            label: "Sequence",
            kind: "number",
            visuallyHidden: true,
          },
        ],
        childLevels: [],
        ...level,
      },
    },
    nodes: [
      posting("p10", "2026-04-04", "Cabs & Autos", 10),
      posting("p9", "2026-04-04", "Groceries", 9),
      posting("p1", "2026-04-02", "Donations", 1),
      posting("opening", "2026-03-31", "Opening balance", 0, "opening"),
    ],
    footerRows: [
      {
        rowKey: "closing",
        columns: { against: "Closing balance" },
      },
    ],
  };
}

// The Date column formats its cells in the display time zone.
setDisplayTimeZone(parseTimeZone("UTC"));

describe("ReportGridDataset sorting", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (mounted) {
      await act(async () => {
        mounted?.root.unmount();
      });
      mounted.container.remove();
      mounted = null;
    }
    window.localStorage.clear();
  });

  async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted = { root, container };
    await act(async () => {
      root.render(element);
    });
    for (let i = 0; i < 20; i += 1) {
      if (container.textContent?.includes("Closing balance")) break;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    return container;
  }

  function displayedAgainst(container: HTMLElement): string[] {
    return [
      ...container.querySelectorAll<HTMLElement>(
        '[data-grid-part="cell"][data-col-id="against"]',
      ),
    ].map((cell) => cell.textContent?.trim() ?? "");
  }

  function dateHeader(container: HTMLElement): HTMLElement {
    const header = container.querySelector(
      '[data-grid-part="header-cell"][data-col-id="date"]',
    );
    if (!(header instanceof HTMLElement)) {
      throw new Error("Expected the Date header");
    }
    return header;
  }

  async function click(element: Element): Promise<void> {
    await act(async () => {
      element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 }),
      );
    });
  }

  it("orders same-day rows by the declared sequence in both directions", async () => {
    const container = await render(
      createElement(ReportGridDataset, { dataset: ledgerDataset() }),
    );
    const header = dateHeader(container);

    await click(header);
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(displayedAgainst(container)).toEqual([
      "Opening balance",
      "Donations",
      "Groceries",
      "Cabs & Autos",
      "Closing balance",
    ]);

    await click(header);
    expect(header.getAttribute("aria-sort")).toBe("descending");
    expect(displayedAgainst(container)).toEqual([
      "Cabs & Autos",
      "Groceries",
      "Donations",
      "Opening balance",
      "Closing balance",
    ]);
  });

  it("starts sorted by the level's declared sort", async () => {
    const container = await render(
      createElement(ReportGridDataset, {
        dataset: ledgerDataset({
          sort: [{ column: "date", direction: "asc" }],
        }),
      }),
    );

    expect(dateHeader(container).getAttribute("aria-sort")).toBe("ascending");
    expect(displayedAgainst(container)).toEqual([
      "Opening balance",
      "Donations",
      "Groceries",
      "Cabs & Autos",
      "Closing balance",
    ]);
  });

  it("rejects a sortBy naming a column the level lacks", async () => {
    const dataset = ledgerDataset();
    const columns = dataset.levels.posting!.columns;
    columns[0] = { ...columns[0]!, sortBy: ["date", "seq"] };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      render(createElement(ReportGridDataset, { dataset })),
    ).rejects.toThrow('sorts by unknown column "seq"');
    errors.mockRestore();
  });

  it("rejects a level sort on a hidden column", async () => {
    const dataset = ledgerDataset({
      sort: [{ column: "sequence", direction: "asc" }],
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      render(createElement(ReportGridDataset, { dataset })),
    ).rejects.toThrow(
      'Dataset "account-ledger" level "posting": sort names column "sequence"',
    );
    errors.mockRestore();
  });
});
