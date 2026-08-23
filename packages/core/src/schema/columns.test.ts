import { describe, expectTypeOf, it } from "vitest";
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import type { Temporal } from "@sapporta/shared/temporal";
import type { TableRow } from "../rows/scoped-rows.js";
import {
  bool,
  date,
  money,
  number,
  percentage,
  select,
  text,
  timestamp,
} from "./columns.js";

const everything = sqliteTable("everything", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  food_name: text("food_name"),
  qty: number("qty"),
  status: select("status", ["draft", "done"]),
  at: timestamp("at"),
  flag: bool("flag"),
  day: date("day"),
  price: money("price"),
  pct: percentage("pct"),
});

/**
 * These assertions are checked by `pnpm typecheck` (`tsc --noEmit`), not by
 * the vitest run — `expectTypeOf` compiles away to nothing at runtime.
 */
describe("factory columns keep their name literal", () => {
  it("gives every factory-declared column its own row type", () => {
    type Row = TableRow<typeof everything>;

    expectTypeOf<Row["food_name"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Row["qty"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Row["status"]>().toEqualTypeOf<"draft" | "done" | null>();
    expectTypeOf<Row["at"]>().toEqualTypeOf<Temporal.Instant | null>();
    expectTypeOf<Row["flag"]>().toEqualTypeOf<boolean | null>();
    expectTypeOf<Row["day"]>().toEqualTypeOf<Temporal.PlainDate | null>();
    expectTypeOf<Row["price"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Row["pct"]>().toEqualTypeOf<number | null>();
  });

  it("leaves no index signature to swallow unknown columns", () => {
    // A widened name parameter collapses every factory column into
    // `[x: string]: ...`, which makes this conditional true.
    type HasIndexSignature = string extends keyof TableRow<typeof everything>
      ? true
      : false;

    expectTypeOf<HasIndexSignature>().toEqualTypeOf<false>();
  });
});
