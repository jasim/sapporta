// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { parseTimeZone, type TimeZone } from "@sapporta/shared/temporal";
import { setDisplayTimeZone } from "../display-zone";
import { columnPreset } from "../index";
import { makeRowId, rootPath } from "../../core/types/identity";
import type { CellRenderProps } from "../../core/types/schema";
import type { LevelRow } from "../../core/types/level-row";
import type { TreeNode } from "../../core/types/level-row";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The page names the zone it reads on, so nothing here stubs the host TZ.
// Asia/Kolkata is +05:30 year-round: the half-hour offset catches whole-hour
// rounding, and an evening UTC instant lands on the next calendar day.
const DISPLAY_TIME_ZONE = parseTimeZone("Asia/Kolkata");
const INSTANT = "2026-08-23T20:30:00Z";

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function renderCellFor(
  kind: "date" | "timestamp",
  value: unknown,
  zone: TimeZone = DISPLAY_TIME_ZONE,
): HTMLElement {
  setDisplayTimeZone(zone);
  const column =
    kind === "timestamp"
      ? columnPreset.timestamp({ id: "created_at", name: "Created at" })
      : columnPreset.date({ id: "issued_on", name: "Issued on" });
  const row: LevelRow = {
    kind: "data",
    id: makeRowId(rootPath("things"), "1"),
    rowSelectable: false,
    columns: { [column.id]: value },
    hasChildren: false,
    source: {} as TreeNode,
  };
  const props: CellRenderProps = {
    value,
    row,
    column,
    path: rootPath("things"),
    activation: null,
  };

  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(column.renderCell(props)));
  const cell = host.querySelector("span");
  if (!cell) throw new Error("expected the cell to render a span");
  return cell;
}

function hover(cell: HTMLElement): void {
  act(() => {
    cell.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

describe("DateCell", () => {
  it("prints a timestamp on the wall clock of the column's zone", () => {
    expect(renderCellFor("timestamp", INSTANT).textContent).toBe(
      "2026-08-24 02:00",
    );
    expect(
      renderCellFor("timestamp", INSTANT, parseTimeZone("UTC")).textContent,
    ).toBe("2026-08-23 20:30");
  });

  it("says nothing about the seconds or the zone until asked", () => {
    const cell = renderCellFor("timestamp", INSTANT);

    expect(cell.getAttribute("title")).toBeNull();

    hover(cell);

    expect(cell.getAttribute("title")).toBe("2026-08-24 02:00:00 (UTC+05:30)");
  });

  it("has no moment to describe on a date column", () => {
    const cell = renderCellFor("date", "2026-08-23");

    hover(cell);

    expect(cell.textContent).toBe("2026-08-23");
    expect(cell.getAttribute("title")).toBeNull();
  });
});
