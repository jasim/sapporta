import { describe, expect, it } from "vitest";
import type { AncestorChain } from "./ancestor";
import { ancestor, renderChain } from "./ancestor";

describe("ancestor()", () => {
  it("returns the rowKey for the matching entry", () => {
    const chain: AncestorChain = [
      { levelName: "orders", rowKey: "O1" },
      { levelName: "lines", rowKey: "L7" },
    ];
    expect(ancestor(chain, "orders")).toBe("O1");
    expect(ancestor(chain, "lines")).toBe("L7");
  });

  it("throws with 'chain is []' when chain is empty", () => {
    expect(() => ancestor([], "orders")).toThrow(
      /No ancestor at level 'orders' — chain is \[\]/,
    );
  });

  it("throws with the rendered chain when level is not present", () => {
    const chain: AncestorChain = [{ levelName: "orders", rowKey: "O1" }];
    expect(() => ancestor(chain, "lines")).toThrow(
      /No ancestor at level 'lines' — chain is \[orders→O1\]/,
    );
  });

  // `124009c` forbids empty-string rowKeys upstream — but `ancestor` itself
  // is a pure lookup and must not double-validate. A levelName match wins
  // even when its rowKey is "" so a buggy caller hits the empty-string
  // case downstream rather than the misleading "no ancestor" branch here.
  it("treats an entry with empty-string rowKey as a real ancestor", () => {
    const chain: AncestorChain = [{ levelName: "orders", rowKey: "" }];
    expect(ancestor(chain, "orders")).toBe("");
  });
});

describe("renderChain()", () => {
  it("renders an empty chain as '[]'", () => {
    expect(renderChain([])).toBe("[]");
  });

  it("renders entries with the level→rowKey notation", () => {
    expect(renderChain([{ levelName: "orders", rowKey: "O1" }])).toBe(
      "[orders→O1]",
    );
    expect(
      renderChain([
        { levelName: "orders", rowKey: "O1" },
        { levelName: "lines", rowKey: "L7" },
      ]),
    ).toBe("[orders→O1, lines→L7]");
  });
});
