import { describe, expect, it, vi } from "vitest";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { createTableLookupRegistry } from "./table-lookup-registry";

const ownerColumn: ColumnSchema = {
  name: "owner_id",
  kind: "number",
  foreignKey: { table: "users", column: "id" },
};

describe("createTableLookupRegistry", () => {
  it("reuses one bundle per FK mapping", () => {
    const registry = createTableLookupRegistry();

    const first = registry.bundleFor({
      sourceTable: "orders",
      column: ownerColumn,
    });
    const second = registry.bundleFor({
      sourceTable: "orders",
      column: ownerColumn,
    });

    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(first).toMatchObject({
      key: "orders.owner_id->users.id",
      sourceTable: "orders",
      sourceColumn: "owner_id",
      targetTable: "users",
      targetColumn: "id",
    });
  });

  it("returns undefined for non-FK columns", () => {
    const registry = createTableLookupRegistry();

    expect(
      registry.bundleFor({
        sourceTable: "orders",
        column: { name: "description", kind: "text" },
      }),
    ).toBeUndefined();
  });

  it("disposes owned lookup objects", () => {
    const registry = createTableLookupRegistry();
    const bundle = registry.bundleFor({
      sourceTable: "orders",
      column: ownerColumn,
    });
    if (!bundle) throw new Error("expected bundle");
    const disposeValue = vi.spyOn(bundle.valueLookup, "dispose");
    const disposeSearch = vi.spyOn(bundle.searchLookup, "dispose");

    registry.dispose();

    expect(disposeValue).toHaveBeenCalledOnce();
    expect(disposeSearch).toHaveBeenCalledOnce();
  });
});
