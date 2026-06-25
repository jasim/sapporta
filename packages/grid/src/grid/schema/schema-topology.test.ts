import { describe, expect, it } from "vitest";
import { buildSchemaTopology } from "./schema-topology";
import type { LevelOptions } from "../types/level-row";
import type { ColumnSchema, GridSchema, LevelSchema } from "../types/schema";

function level(
  name: string,
  childLevels: string[] = [],
  options: LevelOptions = {},
): LevelSchema {
  return { name, columns: [], options, childLevels };
}

function levelWithColumns(name: string, columns: ColumnSchema[]): LevelSchema {
  return { name, columns, options: {}, childLevels: [] };
}

function column(
  id: string,
  overrides: Partial<ColumnSchema> = {},
): ColumnSchema {
  return {
    id: id as never,
    name: id,
    renderCell: ({ value }) => String(value ?? ""),
    ...overrides,
  };
}

// rowKey on expandable levels is required by the GridPath encoding (see
// PROPOSAL-rowkey-paths.md). Use the row's own primary-keyish column for
// these test fixtures.
const byPk: LevelOptions = {
  rowKey: (n) => String(n.columns.id ?? n.columns.name ?? ""),
};

const reportSchema: GridSchema = {
  rootLevel: "orders",
  levels: {
    orders: level("orders", ["lines", "shipments"], byPk),
    lines: level("lines"),
    shipments: level("shipments"),
  },
};

describe("buildSchemaTopology", () => {
  it("rootLevelName matches schema.rootLevel", () => {
    const topo = buildSchemaTopology(reportSchema);
    expect(topo.rootLevelName).toBe("orders");
  });

  it("levelOf returns the LevelSchema for a known level", () => {
    const topo = buildSchemaTopology(reportSchema);
    expect(topo.levelOf("orders")).toBe(reportSchema.levels.orders);
    expect(topo.levelOf("lines")).toBe(reportSchema.levels.lines);
  });

  it("levelOf throws on unknown name and lists available levels", () => {
    const topo = buildSchemaTopology(reportSchema);
    expect(() => topo.levelOf("nope")).toThrow(/unknown level "nope"/);
    expect(() => topo.levelOf("nope")).toThrow(/orders.*lines.*shipments/);
  });

  it("childLevelsOf returns declared list in declaration order", () => {
    const topo = buildSchemaTopology(reportSchema);
    expect(topo.childLevelsOf("orders")).toEqual(["lines", "shipments"]);
  });

  it("childLevelsOf returns [] for a leaf level", () => {
    const topo = buildSchemaTopology(reportSchema);
    expect(topo.childLevelsOf("lines")).toEqual([]);
  });

  it("parentLevelOf returns the unique parent for a non-root level", () => {
    const topo = buildSchemaTopology(reportSchema);
    expect(topo.parentLevelOf("lines")).toBe("orders");
    expect(topo.parentLevelOf("shipments")).toBe("orders");
  });

  it("parentLevelOf returns null for the root level", () => {
    const topo = buildSchemaTopology(reportSchema);
    expect(topo.parentLevelOf("orders")).toBeNull();
  });

  it("childLevelsOf and parentLevelOf throw on unknown names", () => {
    const topo = buildSchemaTopology(reportSchema);
    expect(() => topo.childLevelsOf("nope")).toThrow(/unknown level "nope"/);
    expect(() => topo.parentLevelOf("nope")).toThrow(/unknown level "nope"/);
  });

  it("throws when two parents declare the same child level name", () => {
    const bad: GridSchema = {
      rootLevel: "a",
      levels: {
        a: level("a", ["shared"], byPk),
        b: level("b", ["shared"], byPk),
        shared: level("shared"),
      },
    };
    expect(() => buildSchemaTopology(bad)).toThrow(
      /child level "shared" is declared by two parents.*"a".*"b"/,
    );
  });

  it("throws when rootLevel is not in levels", () => {
    const bad: GridSchema = {
      rootLevel: "missing",
      levels: { orders: level("orders") },
    };
    expect(() => buildSchemaTopology(bad)).toThrow(
      /rootLevel "missing" is not in schema.levels/,
    );
  });

  it("throws on a cycle between two levels", () => {
    const bad: GridSchema = {
      rootLevel: "a",
      levels: {
        a: level("a", ["b"], byPk),
        b: level("b", ["a"], byPk),
      },
    };
    expect(() => buildSchemaTopology(bad)).toThrow(/cycle detected/);
  });

  it("throws on a self-cycle", () => {
    const bad: GridSchema = {
      rootLevel: "a",
      levels: {
        a: level("a", ["a"], byPk),
      },
    };
    expect(() => buildSchemaTopology(bad)).toThrow(/cycle detected/);
  });

  it("throws when an expandable level lacks an explicit options.rowKey", () => {
    const bad: GridSchema = {
      rootLevel: "orders",
      levels: {
        orders: level("orders", ["lines"]), // no rowKey, but expandable
        lines: level("lines"),
      },
    };
    expect(() => buildSchemaTopology(bad)).toThrow(
      /expandable level "orders" must declare options\.rowKey/,
    );
  });

  it("throws when a level has duplicate column ids", () => {
    const bad: GridSchema = {
      rootLevel: "rows",
      levels: {
        rows: levelWithColumns("rows", [column("name"), column("name")]),
      },
    };

    expect(() => buildSchemaTopology(bad)).toThrow(
      /level "rows" has duplicate column id "name"/,
    );
  });

  it("throws when an editable column has repeated gestures", () => {
    const bad: GridSchema = {
      rootLevel: "rows",
      levels: {
        rows: levelWithColumns("rows", [
          column("name", {
            edit: {
              editor: () => null,
              startsOn: ["enter", "enter"],
            },
          }),
        ]),
      },
    };

    expect(() => buildSchemaTopology(bad)).toThrow(
      /column "rows\.name" repeats edit gesture "enter"/,
    );
  });

  it("throws when an activation column has repeated gestures", () => {
    const bad: GridSchema = {
      rootLevel: "rows",
      levels: {
        rows: levelWithColumns("rows", [
          column("name", {
            activation: {
              startsOn: ["click", "click"],
              describe: "Open",
              run: () => {},
            },
          }),
        ]),
      },
    };

    expect(() => buildSchemaTopology(bad)).toThrow(
      /column "rows\.name" repeats activation gesture "click"/,
    );
  });

  it("throws when edit and activation claim the same owning gesture", () => {
    const bad: GridSchema = {
      rootLevel: "rows",
      levels: {
        rows: levelWithColumns("rows", [
          column("name", {
            edit: {
              editor: () => null,
              startsOn: ["enter", "doubleClick"],
            },
            activation: {
              startsOn: ["doubleClick"],
              describe: "Open",
              run: () => {},
            },
          }),
        ]),
      },
    };

    expect(() => buildSchemaTopology(bad)).toThrow(
      /column "rows\.name" assigns "doubleClick" to both edit and activation/,
    );
  });

  it("allows activation-only gestures that do not overlap edit gestures", () => {
    const ok: GridSchema = {
      rootLevel: "rows",
      levels: {
        rows: levelWithColumns("rows", [
          column("name", {
            edit: {
              editor: () => null,
              startsOn: ["enter"],
            },
            activation: {
              startsOn: ["click", "space"],
              describe: "Open",
              run: () => {},
            },
          }),
        ]),
      },
    };

    expect(() => buildSchemaTopology(ok)).not.toThrow();
  });

  it("allows a leaf level to omit options.rowKey", () => {
    const ok: GridSchema = {
      rootLevel: "rows",
      levels: { rows: level("rows") },
    };
    expect(() => buildSchemaTopology(ok)).not.toThrow();
  });

  it("allows semantic level names that contain `.`", () => {
    const ok: GridSchema = {
      rootLevel: "rows",
      levels: {
        rows: level("rows", ["sub.lines"], byPk),
        "sub.lines": level("sub.lines"),
      },
    };
    const topology = buildSchemaTopology(ok);
    expect(topology.childLevelsOf("rows")).toEqual(["sub.lines"]);
    expect(topology.parentLevelOf("sub.lines")).toBe("rows");
  });
});
