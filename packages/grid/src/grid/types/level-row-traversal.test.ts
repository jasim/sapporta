import { describe, expect, it } from "vitest";
import {
  firstFocusableRow,
  lastFocusableRow,
  nextFocusableRow,
} from "./level-row-traversal";
import { capabilitiesFor } from "./capabilities";
import { makeLevelRowId, makeRowId, rootPath } from "./identity";
import type { DisplayedRows, LevelRow } from "./level-row";

const path = rootPath("rows");

function buildDisplayed(
  specs: Array<{ key: string; kind: LevelRow["kind"] }>,
): DisplayedRows {
  const rows: LevelRow[] = specs.map((s): LevelRow => {
    const id = makeLevelRowId(path, s.kind, s.key);
    const rowSelectable = capabilitiesFor(s.kind).rowSelectable;
    if (s.kind === "data") {
      return {
        kind: "data",
        id,
        rowSelectable,
        columns: {},
        hasChildren: false,
        source: { rowKey: s.key, levelName: "rows", columns: {} },
      };
    }
    if (s.kind === "footer") {
      return {
        kind: "footer",
        id,
        rowSelectable,
        columns: {},
        source: { rowKey: s.key, columns: {} },
      };
    }
    if (s.kind === "phantom") {
      return {
        kind: "phantom",
        id,
        rowSelectable,
        columns: {},
        source: { rowKey: s.key, columns: {}, state: { kind: "editing" } },
      };
    }
    return {
      kind: s.kind,
      id,
      rowSelectable,
      columns: {},
      source: { rowKey: s.key, levelName: "rows", columns: {} },
    };
  });
  const rowById = new Map(rows.map((r) => [r.id, r] as const));
  const rowIndexById = new Map(rows.map((r, i) => [r.id, i] as const));
  return { rows, rowById, rowIndexById };
}

describe("level-row-traversal", () => {
  it("firstFocusableRow returns the first row whose capabilities are focusable", () => {
    const d = buildDisplayed([
      { key: "f", kind: "footer" }, // not focusable
      { key: "a", kind: "data" },
      { key: "b", kind: "data" },
    ]);
    expect(firstFocusableRow(d, capabilitiesFor)?.id).toBe(
      makeRowId(path, "a"),
    );
  });

  it("lastFocusableRow returns the last row whose capabilities are focusable", () => {
    const d = buildDisplayed([
      { key: "a", kind: "data" },
      { key: "b", kind: "data" },
      { key: "f", kind: "footer" }, // not focusable
    ]);
    expect(lastFocusableRow(d, capabilitiesFor)?.id).toBe(makeRowId(path, "b"));
  });

  it("returns null when no row is focusable", () => {
    const d = buildDisplayed([
      { key: "f1", kind: "footer" },
      { key: "f2", kind: "footer" },
    ]);
    expect(firstFocusableRow(d, capabilitiesFor)).toBeNull();
    expect(lastFocusableRow(d, capabilitiesFor)).toBeNull();
  });

  it("returns null when displayed is empty", () => {
    const d = buildDisplayed([]);
    expect(firstFocusableRow(d, capabilitiesFor)).toBeNull();
    expect(lastFocusableRow(d, capabilitiesFor)).toBeNull();
    expect(nextFocusableRow(d, -1, 1, capabilitiesFor)).toBeNull();
  });

  it("nextFocusableRow treats fromIndex as exclusive (forward)", () => {
    const d = buildDisplayed([
      { key: "a", kind: "data" },
      { key: "b", kind: "data" },
      { key: "c", kind: "data" },
    ]);
    // From index 0 → searches starting at 1 → returns "b".
    expect(nextFocusableRow(d, 0, 1, capabilitiesFor)?.id).toBe(
      makeRowId(path, "b"),
    );
  });

  it("nextFocusableRow treats fromIndex as exclusive (backward)", () => {
    const d = buildDisplayed([
      { key: "a", kind: "data" },
      { key: "b", kind: "data" },
      { key: "c", kind: "data" },
    ]);
    // From index 2 → searches starting at 1 → returns "b".
    expect(nextFocusableRow(d, 2, -1, capabilitiesFor)?.id).toBe(
      makeRowId(path, "b"),
    );
  });

  it("nextFocusableRow skips non-focusable rows in the walk direction", () => {
    const d = buildDisplayed([
      { key: "a", kind: "data" },
      { key: "f1", kind: "footer" },
      { key: "f2", kind: "footer" },
      { key: "b", kind: "data" },
    ]);
    expect(nextFocusableRow(d, 0, 1, capabilitiesFor)?.id).toBe(
      makeRowId(path, "b"),
    );
    expect(nextFocusableRow(d, 3, -1, capabilitiesFor)?.id).toBe(
      makeRowId(path, "a"),
    );
  });

  it("nextFocusableRow returns null when no focusable row exists in the walk direction", () => {
    const d = buildDisplayed([
      { key: "a", kind: "data" },
      { key: "f1", kind: "footer" },
      { key: "f2", kind: "footer" },
    ]);
    expect(nextFocusableRow(d, 0, 1, capabilitiesFor)).toBeNull();
  });

  it("recognizes every focusable kind via capabilitiesFor", () => {
    // The test guards the contract: focusability is whatever
    // `capabilitiesFor(kind).focusable` says — not a hard-coded list.
    const d = buildDisplayed([
      { key: "f", kind: "footer" },
      { key: "o", kind: "opening" },
      { key: "c", kind: "closing" },
      { key: "s", kind: "subtotal" },
      { key: "p", kind: "phantom" },
      { key: "r", kind: "rollup" },
      { key: "d", kind: "data" },
    ]);
    expect(firstFocusableRow(d, capabilitiesFor)?.id).toBe(
      makeLevelRowId(path, "opening", "o"),
    );
    expect(lastFocusableRow(d, capabilitiesFor)?.id).toBe(makeRowId(path, "d"));
  });
});
