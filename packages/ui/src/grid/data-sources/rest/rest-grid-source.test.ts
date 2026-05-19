import { describe, expect, it, vi } from "vitest";
import { rootPath, type GridPath } from "../../types/identity";
import type { GridSchema } from "../../types/schema";
import type { AncestorChain } from "./ancestor";
import { ancestor } from "./ancestor";
import { restGridDataSource } from "./rest-grid-source";
import type { RestLevelSourceOpts } from "./rest-level-source";

const textColumn = (id: string, name: string) => ({
  id,
  name,
  renderCell: ({ value }: { value: unknown }) => String(value ?? ""),
});
const numberColumn = (id: string, name: string) => ({
  id,
  name,
  renderCell: ({ value }: { value: unknown }) => String(value ?? ""),
});

const orderColumns = [
  textColumn("id", "Id"),
  textColumn("customer", "Customer"),
];
const lineColumns = [textColumn("id", "Id"), numberColumn("amount", "Amount")];
const noteColumns = [textColumn("id", "Id"), textColumn("text", "Text")];

const schema: GridSchema = {
  rootLevel: "orders",
  levels: {
    orders: {
      name: "orders",
      columns: orderColumns,
      options: { rowKey: (n) => String(n.columns.id) },
      childLevels: ["lines"],
    },
    lines: {
      name: "lines",
      columns: lineColumns,
      options: { rowKey: (n) => String(n.columns.id) },
      childLevels: ["notes"],
    },
    notes: {
      name: "notes",
      columns: noteColumns,
      options: { rowKey: (n) => String(n.columns.id) },
      childLevels: [],
    },
  },
};

function makeOpts(): RestLevelSourceOpts {
  return {
    fetchPage: async () => ({ nodes: [] }),
    initialPagination: { page: 0, pageSize: 50 },
    serverManaged: { sort: true, filter: true, pagination: true },
  };
}

describe("restGridDataSource", () => {
  it("rootSource invokes the root factory with ancestors=[] and caches the source across calls", () => {
    const ordersFactory = vi.fn(
      ({ ancestors }: { ancestors: AncestorChain }) => {
        expect(ancestors).toEqual([]);
        return makeOpts();
      },
    );
    const ds = restGridDataSource({
      schema,
      endpoints: { orders: ordersFactory },
    });
    const a = ds.rootSource();
    const b = ds.rootSource();
    expect(a).toBe(b);
    expect(ordersFactory).toHaveBeenCalledTimes(1);
  });

  it("resolveChild on the root passes a single-entry chain to the child factory", () => {
    const linesFactory = vi.fn(
      ({ ancestors }: { ancestors: AncestorChain }) => {
        expect(ancestors).toEqual([{ levelName: "orders", rowKey: "O1" }]);
        return makeOpts();
      },
    );
    const ds = restGridDataSource({
      schema,
      endpoints: {
        orders: () => makeOpts(),
        lines: linesFactory,
      },
    });
    ds.resolveChild(rootPath("orders"), "O1", "lines");
    expect(linesFactory).toHaveBeenCalledTimes(1);
  });

  it("resolveChild at depth 2 passes the full chain leading down to (but not including) the child level", () => {
    const notesFactory = vi.fn(
      ({ ancestors }: { ancestors: AncestorChain }) => {
        expect(ancestors).toEqual([
          { levelName: "orders", rowKey: "O1" },
          { levelName: "lines", rowKey: "L7" },
        ]);
        return makeOpts();
      },
    );
    const ds = restGridDataSource({
      schema,
      endpoints: {
        orders: () => makeOpts(),
        lines: () => makeOpts(),
        notes: notesFactory,
      },
    });
    ds.resolveChild("orders.O1.lines" as GridPath, "L7", "notes");
    expect(notesFactory).toHaveBeenCalledTimes(1);
  });

  it("ancestor() helper inside a factory returns rowKeys; throws with the rendered chain for missing names", () => {
    const linesFactory = ({ ancestors }: { ancestors: AncestorChain }) => {
      expect(ancestor(ancestors, "orders")).toBe("O1");
      expect(() => ancestor(ancestors, "odders")).toThrow(
        /No ancestor at level 'odders' — chain is \[orders→O1\]/,
      );
      return makeOpts();
    };
    const ds = restGridDataSource({
      schema,
      endpoints: {
        orders: () => makeOpts(),
        lines: linesFactory,
      },
    });
    ds.resolveChild(rootPath("orders"), "O1", "lines");
  });

  it("resolveChild called twice returns a fresh source each time (no internal cache)", () => {
    const ds = restGridDataSource({
      schema,
      endpoints: {
        orders: () => makeOpts(),
        lines: () => makeOpts(),
      },
    });
    const a = ds.resolveChild(rootPath("orders"), "O1", "lines");
    const b = ds.resolveChild(rootPath("orders"), "O1", "lines");
    expect(a).not.toBe(b);
  });

  it("dispose chains to root and to every source produced via resolveChild", () => {
    const ds = restGridDataSource({
      schema,
      endpoints: {
        orders: () => makeOpts(),
        lines: () => makeOpts(),
      },
    });
    const root = ds.rootSource();
    const lines = ds.resolveChild(rootPath("orders"), "O1", "lines");
    const rootSub = vi.fn();
    const linesSub = vi.fn();
    root.subscribe(rootSub);
    lines.subscribe(linesSub);

    ds.dispose();

    // setSort would normally trigger subscribers via the loading transition;
    // post-dispose the subscriber set is cleared.
    root.setSort([{ colId: "id", direction: "asc" }]);
    lines.setSort([{ colId: "id", direction: "asc" }]);
    expect(rootSub).not.toHaveBeenCalled();
    expect(linesSub).not.toHaveBeenCalled();
  });

  it("throws at construction when schema.rootLevel is not in schema.levels", () => {
    const bad: GridSchema = {
      rootLevel: "missing",
      levels: { orders: schema.levels.orders },
    };
    expect(() =>
      restGridDataSource({
        schema: bad,
        endpoints: { orders: () => makeOpts() },
      }),
    ).toThrow(/rootLevel 'missing' not found/);
  });

  it("throws when a level used at runtime has no entry in endpoints", () => {
    const ds = restGridDataSource({
      schema,
      endpoints: {
        orders: () => makeOpts(),
        lines: () => makeOpts(),
      },
    });
    expect(() =>
      ds.resolveChild("orders.O1.lines" as GridPath, "L7", "notes"),
    ).toThrow(/endpoints has no entry for level 'notes'/);
  });

  it("rejects a parentPath whose root segment doesn't match schema.rootLevel", () => {
    const ds = restGridDataSource({
      schema,
      endpoints: {
        orders: () => makeOpts(),
        lines: () => makeOpts(),
      },
    });
    expect(() =>
      ds.resolveChild("warehouses.W1.lines" as GridPath, "L7", "notes"),
    ).toThrow(/does not match schema\.rootLevel 'orders'/);
  });
});
