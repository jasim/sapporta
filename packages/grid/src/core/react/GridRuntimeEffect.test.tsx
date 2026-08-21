// @vitest-environment happy-dom

import { Component, StrictMode, act, createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inMemoryGridDataSource } from "../data-sources";
import type { GridDataSource } from "../data-sources/types";
import { createGridRuntime, type RuntimeArgs } from "../runtime";
import { runtimeInternalsFor } from "../runtime/runtime";
import {
  CELL_GRID_WITH_ACTIVE_ROW,
  ROW_PRIMARY_MASTER_DETAIL,
} from "../types/interaction";
import { makeRowId, rootPath } from "../types/identity";
import type { GridSchema } from "../types/schema";
import { useGridRuntimeEffect } from "./GridRuntimeEffect";
import {
  GridRuntimeProvider,
  useGridActiveRow,
  useGridRuntime,
} from "./GridRuntimeProvider";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useGridRuntimeEffect", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (!mounted) return;
    await act(async () => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  });

  async function renderClient(
    element: ReactElement,
    options: { strict?: boolean } = {},
  ): Promise<{ root: Root; container: HTMLElement }> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        options.strict ? createElement(StrictMode, null, element) : element,
      );
    });
    mounted = { root, container };
    return { root, container };
  }

  async function rerenderClient(
    root: Root,
    element: ReactElement,
    options: { strict?: boolean } = {},
  ): Promise<void> {
    await act(async () => {
      root.render(
        options.strict ? createElement(StrictMode, null, element) : element,
      );
    });
  }

  function makeSchema(rootLevel: string): GridSchema {
    return {
      rootLevel,
      levels: {
        [rootLevel]: {
          name: rootLevel,
          rowHeaderColumn: "none",
          columns: [
            {
              id: "name",
              name: "Name",
              renderCell: ({ value }) => String(value ?? ""),
            },
          ],
          options: {},
          childLevels: [],
        },
      },
    };
  }

  function makeArgs(rootLevel: string): {
    args: RuntimeArgs;
    dispose: ReturnType<typeof vi.fn>;
  } {
    const schema = makeSchema(rootLevel);
    const dataSource = withDisposeSpy(
      inMemoryGridDataSource({
        schema,
        tree: [
          { rowKey: "one", levelName: rootLevel, columns: { name: rootLevel } },
        ],
        levels: {
          [rootLevel]: {
            sortMode: "client",
            filterMode: "none",
            paginationMode: "none",
            readonly: false,
          },
        },
      }),
    );
    return {
      args: {
        schema,
        dataSource: dataSource.source,
        interaction: CELL_GRID_WITH_ACTIVE_ROW,
      },
      dispose: dataSource.dispose,
    };
  }

  function withDisposeSpy(source: GridDataSource): {
    source: GridDataSource;
    dispose: ReturnType<typeof vi.fn>;
  } {
    const dispose = vi.fn(() => source.dispose());
    return { source: { ...source, dispose }, dispose };
  }

  it("keeps a runtime live after StrictMode effect replay", async () => {
    const renders: string[] = [];

    function Probe({ rootLevel }: { rootLevel: string }) {
      const runtime = useGridRuntimeEffect(() => {
        const { args } = makeArgs(rootLevel);
        return createGridRuntime(args);
      }, [rootLevel]);
      renders.push(runtime ? runtime.schema.rootLevel : "null");
      return createElement("div", null, runtime?.schema.rootLevel ?? "loading");
    }

    const { container } = await renderClient(
      createElement(Probe, { rootLevel: "orders" }),
      { strict: true },
    );

    expect(container.textContent).toBe("orders");
    expect(renders).toContain("orders");
  });

  it("hides a stale runtime during dependency replacement", async () => {
    const renders: string[] = [];
    let firstDispose: ReturnType<typeof vi.fn> | null = null;
    let secondDispose: ReturnType<typeof vi.fn> | null = null;

    function Probe({ rootLevel }: { rootLevel: string }) {
      const runtime = useGridRuntimeEffect(() => {
        const { args, dispose } = makeArgs(rootLevel);
        if (rootLevel === "orders") firstDispose = dispose;
        if (rootLevel === "invoices") secondDispose = dispose;
        return createGridRuntime(args);
      }, [rootLevel]);
      renders.push(
        runtime ? `runtime:${runtime.schema.rootLevel}` : `null:${rootLevel}`,
      );
      return createElement("div", null, runtime?.schema.rootLevel ?? "loading");
    }

    const { root, container } = await renderClient(
      createElement(Probe, { rootLevel: "orders" }),
    );

    expect(container.textContent).toBe("orders");

    await rerenderClient(root, createElement(Probe, { rootLevel: "invoices" }));

    expect(renders).toContain("null:invoices");
    expect(container.textContent).toBe("invoices");
    expect(firstDispose).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    mounted?.container.remove();
    mounted = null;

    expect(secondDispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the live runtime on unmount", async () => {
    let dispose: ReturnType<typeof vi.fn> | null = null;

    function Probe() {
      const runtime = useGridRuntimeEffect(() => {
        const created = makeArgs("orders");
        dispose = created.dispose;
        return createGridRuntime(created.args);
      }, []);
      return createElement("div", null, runtime?.schema.rootLevel ?? "loading");
    }

    const { root, container } = await renderClient(createElement(Probe));

    expect(container.textContent).toBe("orders");

    await act(async () => {
      root.unmount();
    });
    mounted?.container.remove();
    mounted = null;

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("does not require callers to memoize inline runtime construction", async () => {
    const disposes: Array<ReturnType<typeof vi.fn>> = [];
    let createCount = 0;

    function Probe({ rootLevel, label }: { rootLevel: string; label: string }) {
      const runtime = useGridRuntimeEffect(() => {
        createCount += 1;
        const { args, dispose } = makeArgs(rootLevel);
        disposes.push(dispose);
        return createGridRuntime(args);
      }, [rootLevel]);
      return createElement(
        "div",
        null,
        runtime ? `${runtime.schema.rootLevel}:${label}` : "loading",
      );
    }

    const { root, container } = await renderClient(
      createElement(Probe, { rootLevel: "orders", label: "first" }),
    );

    expect(container.textContent).toBe("orders:first");

    await rerenderClient(
      root,
      createElement(Probe, { rootLevel: "orders", label: "second" }),
    );

    expect(container.textContent).toBe("orders:second");
    expect(createCount).toBe(1);
    expect(disposes[0]).not.toHaveBeenCalled();
  });

  it("composes with GridRuntimeProvider explicitly", async () => {
    function Consumer() {
      const runtime = useGridRuntime();
      return createElement("span", null, runtime.schema.rootLevel);
    }

    function Probe() {
      const runtime = useGridRuntimeEffect(() => {
        const { args } = makeArgs("quotes");
        return createGridRuntime(args);
      }, []);

      if (!runtime) return createElement("span", null, "loading");

      return createElement(GridRuntimeProvider, {
        runtime,
        children: createElement(Consumer),
      });
    }

    const { container } = await renderClient(createElement(Probe));

    expect(container.textContent).toBe("quotes");
  });

  it("provides active-row state through the dedicated hook", async () => {
    const { args } = makeArgs("orders");
    const runtime = createGridRuntime(args);

    function ActiveRowProbe() {
      const active = useGridActiveRow();
      return createElement(
        "output",
        null,
        String(active?.row.columns.name ?? ""),
      );
    }

    const { container } = await renderClient(
      createElement(GridRuntimeProvider, {
        runtime,
        children: createElement(ActiveRowProbe),
      }),
    );
    const path = rootPath("orders");
    await act(async () => {
      runtimeInternalsFor(runtime).cursorManager.moveCellCursorTo({
        path,
        rowId: makeRowId(path, "one"),
        colId: "name",
      });
    });

    expect(container.textContent).toBe("orders");
    runtime.dispose();
  });

  it("reads active-row state from an explicit runtime outside a provider", async () => {
    const { args } = makeArgs("orders");
    const runtime = createGridRuntime(args);

    function ActiveRowProbe() {
      const active = useGridActiveRow(runtime);
      return createElement(
        "output",
        null,
        String(active?.row.columns.name ?? "none"),
      );
    }

    const { container } = await renderClient(createElement(ActiveRowProbe));
    expect(container.textContent).toBe("none");

    const path = rootPath("orders");
    const rowId = makeRowId(path, "one");
    await act(async () => {
      runtimeInternalsFor(runtime).cursorManager.moveCellCursorTo({
        path,
        rowId,
        colId: "name",
      });
    });
    expect(container.textContent).toBe("orders");

    await act(async () => {
      runtime.root.writeCell({ rowId, colId: "name" }, "updated");
    });
    expect(container.textContent).toBe("updated");

    await act(async () => {
      await runtime.root.removeRow("one");
    });
    expect(container.textContent).toBe("none");
    runtime.dispose();
  });

  it("prefers an explicit runtime over a provider runtime", async () => {
    const explicitRuntime = createGridRuntime(makeArgs("explicit").args);
    const contextRuntime = createGridRuntime(makeArgs("context").args);

    for (const runtime of [explicitRuntime, contextRuntime]) {
      const path = runtime.root.path;
      runtimeInternalsFor(runtime).cursorManager.moveCellCursorTo({
        path,
        rowId: makeRowId(path, "one"),
        colId: "name",
      });
    }

    function ActiveRowProbe() {
      const active = useGridActiveRow(explicitRuntime);
      return createElement("output", null, String(active?.row.columns.name));
    }

    const { container } = await renderClient(
      createElement(GridRuntimeProvider, {
        runtime: contextRuntime,
        children: createElement(ActiveRowProbe),
      }),
    );

    expect(container.textContent).toBe("explicit");
    explicitRuntime.dispose();
    contextRuntime.dispose();
  });

  it("requires either an explicit runtime or a provider", async () => {
    class ErrorBoundary extends Component<
      { children: ReactNode },
      { error: Error | null }
    > {
      state = { error: null as Error | null };

      static getDerivedStateFromError(error: Error) {
        return { error };
      }

      render() {
        return this.state.error
          ? createElement("output", null, this.state.error.message)
          : this.props.children;
      }
    }

    function ActiveRowProbe() {
      useGridActiveRow();
      return null;
    }

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { container } = await renderClient(
      createElement(ErrorBoundary, null, createElement(ActiveRowProbe)),
    );
    consoleError.mockRestore();

    expect(container.textContent).toBe(
      "useGridActiveRow requires a runtime argument or GridRuntimeProvider",
    );
  });
});
