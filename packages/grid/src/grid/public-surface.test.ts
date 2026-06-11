import { describe, expect, it } from "vitest";

describe("grid public surface", () => {
  it("does not export removed internal grid APIs", async () => {
    const mod = (await import("./index")) as Record<string, unknown>;

    expect(mod).not.toHaveProperty("GridTree");
    expect(mod).not.toHaveProperty("applyTransaction");
    expect(mod).not.toHaveProperty("Transaction");
    expect(mod).not.toHaveProperty("initialSortByPath");
    expect(mod).not.toHaveProperty("initialFilterByPath");
    expect(mod).not.toHaveProperty("useDisplayedRows");
    expect(mod).not.toHaveProperty("computeDisplayedRows");
  });

  it("exports the runtime, React bridge, and grid data-source factories", async () => {
    const mod = (await import("./index")) as Record<string, unknown>;

    expect(typeof mod.createGridRuntime).toBe("function");
    expect(typeof mod.GridRuntimeProvider).toBe("function");
    expect(typeof mod.GridLevel).toBe("function");
    expect(typeof mod.inMemoryGridDataSource).toBe("function");
    expect(typeof mod.restGridDataSource).toBe("function");
    expect(mod).not.toHaveProperty("inMemoryLevelSource");
    expect(mod).not.toHaveProperty("restLevelSource");
  });
});
