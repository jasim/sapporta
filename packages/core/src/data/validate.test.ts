import { describe, it, expect } from "vitest";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { table, timestamp } from "../schema/table.js";
import { validate, buildZodSchema } from "./validate.js";
import { Temporal } from "@sapporta/shared/temporal";

describe("buildZodSchema()", () => {
  it("infers string fields as required", () => {
    const schema = table({
      drizzle: sqliteTable("test_strings", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        name: text("name").notNull(),
      }),
      meta: { rowLabelColumns: ["name"] },
    });

    const zodSchema = buildZodSchema(schema);
    expect(zodSchema.safeParse({ name: "hello" }).success).toBe(true);
    expect(zodSchema.safeParse({}).success).toBe(false);
    expect(zodSchema.safeParse({ name: 123 }).success).toBe(false);
  });

  it("makes nullable columns nullable", () => {
    const schema = table({
      drizzle: sqliteTable("test_nullable", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        notes: text("notes"),
      }),
      meta: { rowLabelColumns: ["notes"] },
    });

    const zodSchema = buildZodSchema(schema);
    expect(zodSchema.safeParse({ notes: null }).success).toBe(true);
    expect(zodSchema.safeParse({ notes: "hello" }).success).toBe(true);
  });

  it("makes columns with defaults optional", () => {
    const schema = table({
      drizzle: sqliteTable("test_defaults", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        created_at: timestamp("created_at")
          .notNull()
          .$defaultFn(() => Temporal.Now.instant()),
      }),
      meta: { rowLabelColumns: ["id"] },
    });

    const zodSchema = buildZodSchema(schema);
    // created_at has a default, so it should be optional
    expect(zodSchema.safeParse({}).success).toBe(true);
  });

  it("validates select options", () => {
    const schema = table({
      drizzle: sqliteTable("test_selects", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        status: text("status").notNull(),
      }),
      meta: {
        rowLabelColumns: ["status"],
        selects: [
          { type: "select", column: "status", options: ["active", "inactive"] },
        ],
      },
    });

    const zodSchema = buildZodSchema(schema);
    expect(zodSchema.safeParse({ status: "active" }).success).toBe(true);
    expect(zodSchema.safeParse({ status: "invalid" }).success).toBe(false);
  });

  it("uses user-provided validation schema", () => {
    const customSchema = z.object({
      name: z.string().min(3),
    });

    const schema = table({
      drizzle: sqliteTable("test_custom", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        name: text("name").notNull(),
      }),
      meta: { rowLabelColumns: ["name"], validation: customSchema },
    });

    const zodSchema = buildZodSchema(schema);
    expect(zodSchema.safeParse({ name: "ab" }).success).toBe(false);
    expect(zodSchema.safeParse({ name: "abc" }).success).toBe(true);
  });
});

describe("validate()", () => {
  it("returns empty array for valid records", () => {
    const schema = table({
      drizzle: sqliteTable("test_valid", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        name: text("name").notNull(),
      }),
      meta: { rowLabelColumns: ["name"] },
    });

    expect(validate(schema, { name: "hello" })).toEqual([]);
  });

  it("returns field errors for invalid records", () => {
    const schema = table({
      drizzle: sqliteTable("test_invalid", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        name: text("name").notNull(),
        count: integer("count").notNull(),
      }),
      meta: { rowLabelColumns: ["name"] },
    });

    const errors = validate(schema, {});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });
});
