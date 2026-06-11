import { describe, expect, it, vi } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  compactRecordFormValues,
  createRecordFormStore,
  initialRecordFormValues,
} from "@/table/form/record-form-store";

const PRODUCTS_SCHEMA: TableSchema = {
  name: "products",
  label: "Products",
  immutable: false,
  children: [],
  columns: [
    { name: "id", label: "ID", primary: true, hasDefault: true },
    { name: "sku", label: "SKU", notNull: true },
    { name: "name", label: "Name", notNull: true },
    { name: "is_active", label: "Is active" },
    { name: "workspace_id", label: "Workspace", notNull: true },
    { name: "scoped_to_user_id", label: "Scoped to user", notNull: true },
    { name: "server_owned_id", label: "Server owned", clientEditable: false },
  ],
};

const CATEGORIES_SCHEMA: TableSchema = {
  name: "categories",
  label: "Categories",
  immutable: false,
  children: [],
  columns: [
    { name: "id", label: "ID", primary: true, hasDefault: true },
    { name: "name", label: "Name", notNull: true },
  ],
};

describe("record form store", () => {
  it("initializes editable columns to null and omits generated primary keys", () => {
    expect(initialRecordFormValues(PRODUCTS_SCHEMA)).toEqual({
      sku: null,
      name: null,
      is_active: null,
    });
  });

  it("stores field values without notifying on idempotent writes", () => {
    const store = createRecordFormStore(PRODUCTS_SCHEMA);
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    store.getState().setValue("sku", "A-1");
    expect(store.getState().values).toMatchObject({ sku: "A-1" });
    expect(subscriber).toHaveBeenCalledTimes(1);

    store.getState().setValue("sku", "A-1");
    expect(subscriber).toHaveBeenCalledTimes(1);
  });

  it("resets to the next schema's initial values", () => {
    const store = createRecordFormStore(PRODUCTS_SCHEMA);
    store.getState().setValue("sku", "A-1");

    store.getState().reset(CATEGORIES_SCHEMA);

    expect(store.getState().values).toEqual({ name: null });
  });

  it("compacts only nullish values before submit", () => {
    expect(
      compactRecordFormValues({
        sku: "A-1",
        name: "",
        is_active: false,
        reorder_point: 0,
        notes: null,
        lead_time_days: undefined,
      }),
    ).toEqual({
      sku: "A-1",
      name: "",
      is_active: false,
      reorder_point: 0,
    });
  });
});
