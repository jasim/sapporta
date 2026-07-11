import { describe, expectTypeOf, it } from "vitest";
import type { RuntimeArgs, GridRuntime } from "../runtime";
import type { CursorContinuation } from "../interaction/cursor-continuation";
import type { FetchPageRequest } from "../data-sources/types";
import type { GridAction } from "./action";
import type { GridSchema } from "./schema";

function assertReadonlyPublicModels(
  runtime: GridRuntime,
  args: RuntimeArgs,
  action: GridAction,
  request: FetchPageRequest,
  continuation: CursorContinuation,
): void {
  const displayed = runtime.root.displayedRows();
  const row = displayed.rows[0]!;
  const state = runtime.root.data.state();
  const node = state.snapshot.nodes[0]!;
  const draft = runtime.root.drafts.get()[0]!;
  const target = runtime.root.dataRowTarget(row.id)!;

  // @ts-expect-error Public schema snapshots are readonly.
  runtime.schema.rootLevel = "other";
  // @ts-expect-error The level lookup is readonly.
  runtime.schema.levels.rows = runtime.schema.levels.rows;
  // @ts-expect-error Level column arrays are readonly.
  runtime.schema.levels.rows.columns.push(
    runtime.schema.levels.rows.columns[0]!,
  );
  // @ts-expect-error Runtime interaction snapshots are readonly.
  runtime.interaction.mode = "row-list";
  // @ts-expect-error Source snapshot node arrays are readonly.
  state.snapshot.nodes.push(node);
  // @ts-expect-error TreeNode columns are readonly.
  node.columns.name = "changed";
  // @ts-expect-error Displayed row arrays are readonly.
  displayed.rows.push(row);
  // @ts-expect-error Displayed row maps expose no mutation methods.
  displayed.rowById.set(row.id, row);
  // @ts-expect-error Displayed row columns are readonly.
  row.columns.name = "changed";
  // @ts-expect-error Draft arrays are readonly.
  runtime.root.drafts.get().push(draft);
  // @ts-expect-error Row-operation targets are readonly.
  target.rowKey = "other";
  // @ts-expect-error Runtime construction arguments are readonly.
  args.schema = runtime.schema;
  // @ts-expect-error Runtime source-view methods are stable readonly ports.
  runtime.root.data.state = runtime.root.data.state;
  // @ts-expect-error Runtime source-view subscriptions are readonly ports.
  runtime.root.data.subscribe = runtime.root.data.subscribe;
  // @ts-expect-error Runtime source-view capabilities are readonly.
  runtime.root.data.query = runtime.root.data.query;
  // @ts-expect-error Interaction action records are readonly.
  action.type = "CANCEL_EDIT";
  // @ts-expect-error Wire/query request records are readonly.
  request.page = 2;
  // @ts-expect-error Advanced cursor plans are readonly.
  continuation.kind = "grid";
}

void assertReadonlyPublicModels;

describe("readonly public grid types", () => {
  it("uses the public schema type without a mutable mirror", () => {
    expectTypeOf<GridRuntime["schema"]>().toEqualTypeOf<GridSchema>();
    expectTypeOf<RuntimeArgs["schema"]>().toEqualTypeOf<GridSchema>();
  });
});
