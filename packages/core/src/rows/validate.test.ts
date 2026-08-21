import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { money, sapportaTable, select, timestamp } from "../schema/table.js";
import { parseTableWrite } from "./validate.js";

const statuses = ["draft", "posted"] as const;

describe("parseTableWrite", () => {
  it("applies required, defaulted, nullable, select, and finite-number structure", () => {
    const table = sapportaTable({
      drizzle: sqliteTable("invoices", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        number: text("number").notNull(),
        status: select("status", statuses).notNull(),
        total: money("total").notNull(),
        notes: text("notes"),
      }),
      meta: { rowLabelColumns: ["number"], rowScope: "systemGlobal" },
    });

    expect(
      parseTableWrite(
        table,
        { number: "INV-1", status: "draft", total: 12.5, notes: null },
        "insert",
      ),
    ).toMatchObject({ success: true });
    expect(parseTableWrite(table, {}, "insert")).toMatchObject({
      success: false,
    });
    expect(
      parseTableWrite(
        table,
        { number: "INV-1", status: "unknown", total: 12.5 },
        "insert",
      ),
    ).toMatchObject({ success: false });
    expect(
      parseTableWrite(
        table,
        { number: "INV-1", status: "draft", total: Number.POSITIVE_INFINITY },
        "insert",
      ),
    ).toMatchObject({ success: false });
  });

  it("uses patch semantics and reports the operation to application validation", () => {
    const operations: string[] = [];
    const table = sapportaTable({
      drizzle: sqliteTable("patch_invoices", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        number: text("number").notNull(),
        totalAmount: money("total_amount").notNull(),
      }),
      meta: { rowLabelColumns: ["number"], rowScope: "systemGlobal" },
      validate(value, context) {
        expectTypeOf(value.total_amount).toEqualTypeOf<number | undefined>();
        operations.push(context.operation);
      },
    });

    expect(parseTableWrite(table, { total_amount: 20 }, "patch")).toEqual({
      success: true,
      data: { total_amount: 20 },
    });
    expect(
      parseTableWrite(table, { total_amount: "20" }, "patch"),
    ).toMatchObject({ success: false });
    expect(operations).toEqual(["patch"]);
  });

  it("composes application issues after structure and cannot weaken other fields", () => {
    const validateCall = vi.fn();
    const table = sapportaTable({
      drizzle: sqliteTable("validated_invoices", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        name: text("name").notNull(),
        total: money("total").notNull(),
      }),
      meta: { rowLabelColumns: ["name"], rowScope: "systemGlobal" },
      validate(value, context) {
        validateCall();
        if (context.operation === "insert" && value.total === 0) {
          context.addIssue("total", "Total must be greater than zero.");
        }
      },
    });

    expect(
      parseTableWrite(table, { name: "INV-1", total: 0 }, "insert"),
    ).toEqual({
      success: false,
      issues: [{ field: "total", message: "Total must be greater than zero." }],
    });
    expect(
      parseTableWrite(table, { name: 123, total: 1 }, "insert"),
    ).toMatchObject({ success: false });
    expect(validateCall).toHaveBeenCalledTimes(1);
  });

  it("returns canonical Temporal transform output", () => {
    const table = sapportaTable({
      drizzle: sqliteTable("events", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        name: text("name").notNull(),
        starts_at: timestamp("starts_at").notNull(),
      }),
      meta: { rowLabelColumns: ["name"], rowScope: "systemGlobal" },
      validate(value) {
        expectTypeOf(value.starts_at).toEqualTypeOf<string | undefined>();
      },
    });

    expect(
      parseTableWrite(
        table,
        { name: "Launch", starts_at: "2026-07-18T10:30:45.999+05:30" },
        "insert",
      ),
    ).toEqual({
      success: true,
      data: { name: "Launch", starts_at: "2026-07-18T05:00:45Z" },
    });
  });
});
