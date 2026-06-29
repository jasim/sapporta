import { describe, expect, it } from "vitest";
import { shouldRenderEmpty } from "./EmptyLevel";
import type { LevelSnapshot, LevelSourceState } from "../data-sources/types";
import type { TreeNode } from "../types/level-row";

const ready: LevelSnapshot = {
  nodes: [],
  serverManaged: { sort: false, filter: false, pagination: false },
};

const readyState = (snapshot: LevelSnapshot = ready): LevelSourceState => ({
  status: "ready",
  snapshot,
});

const oneNode: TreeNode = { levelName: "rows", columns: { id: "a" } };

describe("shouldRenderEmpty", () => {
  it("renders when ready + no rows + no phantoms + no footers", () => {
    expect(shouldRenderEmpty(readyState(), 0)).toBe(true);
  });

  it("does NOT render while initial loading — the status band owns that slot", () => {
    expect(
      shouldRenderEmpty(
        {
          status: "initialLoading",
          snapshot: ready,
          pending: { page: 0, pageSize: 25 },
        },
        0,
      ),
    ).toBe(false);
  });

  it("does NOT render on initial error", () => {
    expect(
      shouldRenderEmpty(
        {
          status: "initialError",
          snapshot: ready,
          error: new Error("failed"),
          retry: { page: 0, pageSize: 25 },
        },
        0,
      ),
    ).toBe(false);
  });

  it("does NOT render when nodes are present", () => {
    expect(shouldRenderEmpty(readyState({ ...ready, nodes: [oneNode] }), 0)).toBe(false);
  });

  it("does NOT render when phantoms are present", () => {
    expect(shouldRenderEmpty(readyState(), 1)).toBe(false);
  });

  it("does NOT render when footer rows are present", () => {
    expect(
      shouldRenderEmpty(
        readyState({
          ...ready,
          footerRows: [{ rowKey: "footer-total", columns: { qty: 0 } }],
        }),
        0,
      ),
    ).toBe(false);
  });

  it("renders when footerRows is an empty array (treated as none)", () => {
    expect(shouldRenderEmpty(readyState({ ...ready, footerRows: [] }), 0)).toBe(true);
  });
});
