import { describe, it, expect, vi } from "vitest";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { table } from "./table.js";
import { SchemaRegistry } from "./registry.js";

function makeTable(name: string) {
  return table({
    drizzle: sqliteTable(name, {
      id: integer("id").primaryKey({ autoIncrement: true }),
      name: text("name").notNull(),
    }),
  });
}

describe("SchemaRegistry", () => {
  it("register and retrieve defs", () => {
    const reg = new SchemaRegistry();
    const a = makeTable("accounts");
    const b = makeTable("invoices");
    reg.register(a);
    reg.register(b);

    expect(reg.has("accounts")).toBe(true);
    expect(reg.has("invoices")).toBe(true);
    expect(reg.has("unknown")).toBe(false);
    expect(reg.get("accounts")?.def).toBe(a);
  });

  it("all() returns defs in insertion order", () => {
    const reg = new SchemaRegistry();
    const a = makeTable("alpha");
    const b = makeTable("beta");
    const c = makeTable("gamma");
    reg.register(a);
    reg.register(b);
    reg.register(c);

    const names = reg.all().map((d) => d.sqlName);
    expect(names).toEqual(["alpha", "beta", "gamma"]);
  });

  it("unregister removes the entry", () => {
    const reg = new SchemaRegistry();
    reg.register(makeTable("accounts"));
    expect(reg.has("accounts")).toBe(true);

    reg.unregister("accounts");
    expect(reg.has("accounts")).toBe(false);
    expect(reg.all()).toHaveLength(0);
  });

  it("unregister is a no-op for unknown names", () => {
    const reg = new SchemaRegistry();
    reg.unregister("nonexistent");
    expect(reg.all()).toHaveLength(0);
  });

  it("onChange fires on register and unregister", () => {
    const reg = new SchemaRegistry();
    const listener = vi.fn();
    reg.onChange(listener);

    reg.register(makeTable("accounts"));
    expect(listener).toHaveBeenCalledWith("accounts");
    expect(listener).toHaveBeenCalledTimes(1);

    reg.unregister("accounts");
    expect(listener).toHaveBeenCalledWith("accounts");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("re-registering same name replaces the def, keeps position", () => {
    const reg = new SchemaRegistry();
    const v1 = makeTable("accounts");
    const v2 = makeTable("accounts");
    reg.register(v1);
    reg.register(v2);

    expect(reg.get("accounts")?.def).toBe(v2);
    expect(reg.all()).toHaveLength(1);
  });
});
