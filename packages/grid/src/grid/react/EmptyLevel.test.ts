import { describe, expect, it } from "vitest";
import { shouldRenderEmpty } from "./EmptyLevel";
import type { LevelSnapshot } from "../data-sources/types";
import type { TreeNode } from "../types/level-row";

const ready: LevelSnapshot = {
  status: "ready",
  nodes: [],
  serverManaged: { sort: false, filter: false, pagination: false },
};

const oneNode: TreeNode = { levelName: "rows", columns: { id: "a" } };

describe("shouldRenderEmpty", () => {
  it("renders when ready + no rows + no phantoms + no footers", () => {
    expect(shouldRenderEmpty(ready, 0)).toBe(true);
  });

  it("does NOT render while loading — the status band owns that slot", () => {
    expect(shouldRenderEmpty({ ...ready, status: "loading" }, 0)).toBe(false);
  });

  it("does NOT render while idle", () => {
    expect(shouldRenderEmpty({ ...ready, status: "idle" }, 0)).toBe(false);
  });

  it("does NOT render on error", () => {
    expect(shouldRenderEmpty({ ...ready, status: "error" }, 0)).toBe(false);
  });

  it("does NOT render when nodes are present", () => {
    expect(shouldRenderEmpty({ ...ready, nodes: [oneNode] }, 0)).toBe(false);
  });

  it("does NOT render when phantoms are present", () => {
    expect(shouldRenderEmpty(ready, 1)).toBe(false);
  });

  it("does NOT render when footer rows are present", () => {
    expect(
      shouldRenderEmpty(
        {
          ...ready,
          footerRows: [{ rowKey: "footer-total", columns: { qty: 0 } }],
        },
        0,
      ),
    ).toBe(false);
  });

  it("renders when footerRows is an empty array (treated as none)", () => {
    expect(shouldRenderEmpty({ ...ready, footerRows: [] }, 0)).toBe(true);
  });
});
