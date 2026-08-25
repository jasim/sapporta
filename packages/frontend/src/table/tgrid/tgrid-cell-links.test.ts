// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ColumnSchema as TableColumnSchema } from "@sapporta/shared/contracts";
import {
  rootPath,
  type CellRenderProps,
  type ColumnSchema as GridColumnSchema,
  type LevelRow,
  type TreeNode,
} from "@sapporta/grid";
import {
  resolveTGridCellLinks,
  resolveTGridRowLinks,
  withTGridCellLinks,
} from "./tgrid-cell-links";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const fkColumn: TableColumnSchema = {
  name: "account_id",
  label: "Account",
  kind: "number",
  foreignKey: { table: "accounts", column: "id" },
  links: [
    {
      kind: "table",
      table: "accounts",
      bind: { id: "account_id" },
      icon: "drill-up",
    },
  ],
};

function dataRow(columns: Record<string, unknown>): LevelRow {
  const source: TreeNode = { rowKey: "r-1", levelName: "accounts", columns };
  return {
    kind: "data",
    id: "r-1" as LevelRow["id"],
    rowSelectable: true,
    columns,
    hasChildren: false,
    source,
  };
}

function baseGridColumn(): GridColumnSchema {
  return {
    id: "account_id",
    name: "Account",
    renderCell: () => "cell-content",
  } as unknown as GridColumnSchema;
}

function renderProps(row: LevelRow, value: unknown): CellRenderProps {
  return {
    value,
    row,
    column: baseGridColumn(),
    path: rootPath("accounts"),
    activation: null,
  };
}

describe("resolveTGridCellLinks", () => {
  it("resolves declared links against a data row", () => {
    const links = resolveTGridCellLinks(fkColumn, dataRow({ account_id: 42 }));
    expect(links).toHaveLength(1);
    expect(links[0].href).toContain("/tables/accounts?");
    expect(links[0].icon).toBe("drill-up");
  });

  it("returns nothing for null FK values and non-data rows", () => {
    expect(
      resolveTGridCellLinks(fkColumn, dataRow({ account_id: null })),
    ).toHaveLength(0);

    const footer: LevelRow = {
      kind: "footer",
      id: "f-1" as LevelRow["id"],
      rowSelectable: false,
      columns: { account_id: 42 },
      source: { rowKey: "f-1", columns: { account_id: 42 } },
    };
    expect(resolveTGridCellLinks(fkColumn, footer)).toHaveLength(0);
  });
});

describe("resolveTGridRowLinks", () => {
  it("resolves row links against a data row", () => {
    const links = resolveTGridRowLinks(
      [
        {
          kind: "table",
          table: "line_items",
          bind: { order_id: "id" },
          label: "Open Line Items",
          icon: "drill-into",
        },
      ],
      dataRow({ id: 9 }),
    );
    expect(links).toHaveLength(1);
    expect(links[0].label).toBe("Open Line Items");
  });
});

describe("withTGridCellLinks", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (mounted) {
      await act(async () => {
        mounted?.root.unmount();
      });
      mounted.container.remove();
      mounted = null;
    }
  });

  async function renderNode(node: ReactNode): Promise<HTMLElement> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement("div", null, node));
    });
    mounted = { root, container };
    return container;
  }

  it("returns the column unchanged when no links are declared", () => {
    const plain: TableColumnSchema = {
      name: "amount",
      label: "Amount",
      kind: "number",
    };
    const column = baseGridColumn();
    expect(withTGridCellLinks(column, plain)).toBe(column);
  });

  it("renders a trailing link adornment when the link resolves", async () => {
    const wrapped = withTGridCellLinks(baseGridColumn(), fkColumn);
    const container = await renderNode(
      wrapped.renderCell(renderProps(dataRow({ account_id: 42 }), 42)),
    );
    const anchor = container.querySelector('a[data-grid-part="cell-link"]');
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toContain("/tables/accounts?");
    expect(container.textContent).toContain("cell-content");
  });

  it("renders plain content when the link does not resolve", async () => {
    const wrapped = withTGridCellLinks(baseGridColumn(), fkColumn);
    const container = await renderNode(
      wrapped.renderCell(renderProps(dataRow({ account_id: null }), null)),
    );
    expect(container.querySelector('a[data-grid-part="cell-link"]')).toBeNull();
    expect(container.textContent).toContain("cell-content");
  });

  it("describes the Enter activation from the row's resolved link", () => {
    const wrapped = withTGridCellLinks(baseGridColumn(), fkColumn);
    const activation = wrapped.activation!;
    expect(activation.startsOn).toContain("enter");
    const describe = activation.describe;
    expect(typeof describe).toBe("function");
    if (typeof describe !== "function") return;

    const context = {
      row: dataRow({ account_id: 42 }),
    } as Parameters<typeof describe>[0];
    expect(describe(context).availability.kind).toBe("enabled");

    const disabled = describe({
      row: dataRow({ account_id: null }),
    } as Parameters<typeof describe>[0]);
    expect(disabled.availability.kind).toBe("disabled");
  });
});
