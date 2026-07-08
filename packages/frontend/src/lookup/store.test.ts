import { describe, expect, it } from "vitest";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { createLookupStore } from "./store";

const ownerColumn: ColumnSchema = {
  name: "owner_id",
  label: "Owner",
  kind: "number",
  foreignKey: { table: "users", column: "id" },
};

describe("createLookupStore", () => {
  it("reuses one lookup source per target table", () => {
    const store = createLookupStore();

    const tableLookup = store.table("users");
    const fkLookup = store.foreignKey(ownerColumn);
    const requiredLookup = store.requireForeignKey({
      tableName: "orders",
      column: ownerColumn,
    });

    expect(fkLookup).toBe(tableLookup);
    expect(requiredLookup).toBe(tableLookup);
  });

  it("returns undefined for non-FK columns", () => {
    const store = createLookupStore();

    expect(
      store.foreignKey({
        name: "description",
        label: "Description",
        kind: "text",
      }),
    ).toBeUndefined();
  });

  it("clears memoized lookup references", () => {
    const store = createLookupStore();
    const first = store.table("users");

    store.clear();

    expect(store.table("users")).not.toBe(first);
  });
});
