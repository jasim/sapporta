import { describe, expect, it, vi } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  createRecordFormStore,
  initialRecordFormValues,
} from "./record-form-store";

const PRODUCTS_SCHEMA: TableSchema = {
  name: "products",
  label: "Products",
  immutable: false,
  rowLabelColumns: ["name"],
  children: [],
  columns: [
    {
      name: "id",
      label: "ID",
      kind: "number",
      primary: true,
      hasDefault: true,
    },
    { name: "sku", label: "SKU", kind: "text", notNull: true },
    { name: "name", label: "Name", kind: "text", notNull: true },
    { name: "is_active", label: "Is active", kind: "boolean" },
    { name: "workspace_id", label: "Workspace", kind: "text", notNull: true },
    {
      name: "scoped_to_user_id",
      label: "Scoped to user",
      kind: "text",
      notNull: true,
    },
    {
      name: "server_owned_id",
      label: "Server owned",
      kind: "text",
      apiWritable: false,
    },
  ],
};

const CATEGORIES_SCHEMA: TableSchema = {
  name: "categories",
  label: "Categories",
  immutable: false,
  rowLabelColumns: ["name"],
  children: [],
  columns: [
    {
      name: "id",
      label: "ID",
      kind: "number",
      primary: true,
      hasDefault: true,
    },
    { name: "name", label: "Name", kind: "text", notNull: true },
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

  it("clears a field issue without losing other issues when its draft changes", () => {
    const store = createRecordFormStore(PRODUCTS_SCHEMA);
    store.getState().setIssues([
      { field: "sku", message: "SKU is required." },
      { field: "name", message: "Name is required." },
    ]);

    store.getState().setValue("sku", "A-1");

    expect(store.getState().issues).toEqual({ name: "Name is required." });
  });
});
