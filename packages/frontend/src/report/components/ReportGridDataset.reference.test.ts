// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LookupResponse } from "@sapporta/shared/contracts";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { RowDisplayProvider } from "../../lookup/row-display";
import type {
  LabelSlotProps,
  RowDisplays,
} from "../../lookup/row-display-types";
import {
  ReportGridDataset,
  type ReportCellRenderers,
} from "./ReportGridDataset";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { fetchLookup, fetchLookupSearch } = vi.hoisted(() => ({
  fetchLookup: vi.fn(),
  fetchLookupSearch: vi.fn(),
}));

vi.mock("../../lookup/api/lookup", () => ({ fetchLookup, fetchLookupSearch }));

vi.mock("../../table/page/table-page-mode", () => ({
  useTablePageMode: () => ({ ref: { current: null }, mode: "wide" }),
}));

function AccountLabel({ label, computed }: LabelSlotProps) {
  return createElement(
    "span",
    { "data-account-label": "" },
    `${label} in ${String(computed.parentPath)}`,
  );
}

const displays: RowDisplays = {
  accounts: { label: { needs: ["parentPath"], render: AccountLabel } },
};

function ledger(computed?: GridDataset["computed"]): GridDataset {
  return {
    name: "ledger",
    label: "Ledger",
    rootLevel: "groups",
    levels: {
      groups: {
        columns: [
          { id: "group_id", label: "ID", kind: "number", visuallyHidden: true },
          { id: "group", label: "Group", kind: "text" },
        ],
        childLevels: ["lines"],
      },
      lines: {
        columns: [
          {
            id: "account_id",
            label: "ID",
            kind: "number",
            visuallyHidden: true,
          },
          {
            id: "account",
            label: "Account",
            kind: "text",
            reference: { table: "accounts", idColumn: "account_id" },
            links: [
              {
                kind: "table",
                table: "accounts",
                bind: { id: "account_id" },
              },
            ],
          },
          { id: "amount", label: "Amount", kind: "number" },
        ],
        childLevels: [],
      },
    },
    nodes: [
      {
        rowKey: "g1",
        levelName: "groups",
        columns: { group_id: 1, group: "Assets" },
        children: {
          lines: [
            {
              rowKey: "l1",
              levelName: "lines",
              columns: { account_id: 2, account: "Cash", amount: 10 },
            },
            {
              rowKey: "l2",
              levelName: "lines",
              columns: { account_id: 3, account: "Bank", amount: 20 },
            },
          ],
        },
      },
    ],
    ...(computed ? { computed } : {}),
  };
}

const PATHS = { "2": "Assets", "3": "Assets / Current" };

describe("ReportGridDataset reference columns", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    fetchLookup.mockReset();
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
      root.render(createElement(RowDisplayProvider, { displays }, element));
    });
    return container;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  function accountLabels(container: HTMLElement): string[] {
    return [...container.querySelectorAll("[data-account-label]")].map(
      (element) => element.textContent ?? "",
    );
  }

  it("draws the label slot from values sent with the report, without a request", async () => {
    const container = await render(
      createElement(ReportGridDataset, {
        dataset: ledger({ accounts: { parentPath: PATHS } }),
      }),
    );
    await settle();

    expect(accountLabels(container)).toEqual([
      "Cash in Assets",
      "Bank in Assets / Current",
    ]);
    expect(fetchLookup).not.toHaveBeenCalled();
    // The column's link still wraps the reference drawing.
    const link = container.querySelector(
      '[data-col-id="account"] [data-grid-part="report-primary-link"]',
    );
    expect(link?.querySelector("[data-account-label]")).not.toBeNull();
  });

  it("asks for missing values in one lookup per table", async () => {
    fetchLookup.mockImplementation(
      async (
        _table: string,
        ids: readonly string[],
      ): Promise<LookupResponse> => ({
        entries: [],
        computed: {
          parentPath: Object.fromEntries(
            ids.map((id) => [id, PATHS[id as keyof typeof PATHS]]),
          ),
        },
      }),
    );
    const container = await render(
      createElement(ReportGridDataset, { dataset: ledger() }),
    );
    await settle();

    expect(fetchLookup).toHaveBeenCalledTimes(1);
    expect(fetchLookup).toHaveBeenCalledWith(
      "accounts",
      ["2", "3"],
      ["parentPath"],
    );
    expect(accountLabels(container)).toEqual([
      "Cash in Assets",
      "Bank in Assets / Current",
    ]);
  });

  it("gives a column's cell renderer the reference drawing as defaultContent", async () => {
    const renderCell: ReportCellRenderers = {
      lines: {
        account: ({ defaultContent }) =>
          createElement("em", { "data-override": "" }, defaultContent),
      },
    };
    const container = await render(
      createElement(ReportGridDataset, {
        dataset: ledger({ accounts: { parentPath: PATHS } }),
        renderCell,
      }),
    );
    await settle();

    const overridden = container.querySelectorAll(
      "[data-override] [data-account-label]",
    );
    expect(overridden).toHaveLength(2);
  });
});
