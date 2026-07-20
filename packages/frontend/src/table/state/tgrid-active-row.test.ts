import { describe, expectTypeOf, it } from "vitest";
import type { LevelRow } from "@sapporta/grid";
import type { TGridActiveRow } from "./tgrid-active-row";

type Rows = {
  orders: { id: number; customer: string };
};

type ContextFor<Kind extends LevelRow["kind"]> = Extract<
  TGridActiveRow<Rows>,
  { kind: Kind }
>;

describe("TGrid active row public types", () => {
  it("represents every core row kind with the correct values projection", () => {
    expectTypeOf<ContextFor<"data">["values"]>().toEqualTypeOf<
      Readonly<Rows["orders"]>
    >();
    expectTypeOf<ContextFor<"rollup">["values"]>().toEqualTypeOf<
      Readonly<Partial<Rows["orders"]>>
    >();
    expectTypeOf<ContextFor<"opening">["values"]>().toEqualTypeOf<
      Readonly<Partial<Rows["orders"]>>
    >();
    expectTypeOf<ContextFor<"closing">["values"]>().toEqualTypeOf<
      Readonly<Partial<Rows["orders"]>>
    >();
    expectTypeOf<ContextFor<"subtotal">["values"]>().toEqualTypeOf<
      Readonly<Partial<Rows["orders"]>>
    >();
    expectTypeOf<ContextFor<"footer">["values"]>().toEqualTypeOf<
      Readonly<Partial<Rows["orders"]>>
    >();
    expectTypeOf<ContextFor<"phantom">["values"]>().toEqualTypeOf<
      Readonly<Partial<Rows["orders"]>>
    >();
    expectTypeOf<
      ContextFor<"data">["kind"]
    >().toEqualTypeOf<"data">();
    expectTypeOf<
      ContextFor<"rollup">["kind"]
    >().toEqualTypeOf<"rollup">();
    expectTypeOf<
      ContextFor<"opening">["kind"]
    >().toEqualTypeOf<"opening">();
    expectTypeOf<
      ContextFor<"closing">["kind"]
    >().toEqualTypeOf<"closing">();
    expectTypeOf<
      ContextFor<"subtotal">["kind"]
    >().toEqualTypeOf<"subtotal">();
    expectTypeOf<
      ContextFor<"footer">["kind"]
    >().toEqualTypeOf<"footer">();
    expectTypeOf<
      ContextFor<"phantom">["kind"]
    >().toEqualTypeOf<"phantom">();
  });
});
