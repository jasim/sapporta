import { describe, expectTypeOf, it } from "vitest";
import type {
  LevelDataSource,
  LevelSnapshot,
  ReadonlyLevelDataSource,
  ReconcileEvent,
  WritableLevelDataSource,
} from "./types";

describe("LevelDataSource discriminated union", () => {
  // The `writable` literal must narrow the union without a cast — this is
  // the contract that lets the runtime check `source.writable` once and
  // call edit verbs without TypeScript complaining.
  it("narrows to ReadonlyLevelDataSource when writable is false", () => {
    function check(source: LevelDataSource) {
      if (!source.writable) {
        expectTypeOf(source).toEqualTypeOf<ReadonlyLevelDataSource>();
        // setCell must NOT exist on the narrowed type.
        // @ts-expect-error — readonly source has no setCell verb.
        source.setCell;
      }
    }
    check({} as LevelDataSource);
  });

  it("narrows to WritableLevelDataSource when writable is true", () => {
    function check(source: LevelDataSource) {
      if (source.writable) {
        expectTypeOf(source).toEqualTypeOf<WritableLevelDataSource>();
        // Edit verbs and reconciliation are present on the narrowed type.
        expectTypeOf(source.setCell).toBeFunction();
        expectTypeOf(source.applyChanges).toBeFunction();
        expectTypeOf(source.insertNode).toBeFunction();
        expectTypeOf(source.removeNode).toBeFunction();
        expectTypeOf(source.onReconcile).toBeFunction();
      }
    }
    check({} as LevelDataSource);
  });
});

describe("ReconcileEvent discriminated union", () => {
  it("kind switch exhaustively narrows the three variants", () => {
    function check(e: ReconcileEvent): string {
      switch (e.kind) {
        case "agreed":
          expectTypeOf(e.value).toBeUnknown();
          return "agreed";
        case "diverged":
          expectTypeOf(e.optimisticValue).toBeUnknown();
          expectTypeOf(e.authoritativeValue).toBeUnknown();
          expectTypeOf(e.priorValue).toBeUnknown();
          return "diverged";
        case "rejected":
          expectTypeOf(e.optimisticValue).toBeUnknown();
          expectTypeOf(e.reason).toBeString();
          expectTypeOf(e.priorValue).toBeUnknown();
          return "rejected";
        default: {
          // If a new variant is added without updating this switch, the
          // assignment to `never` is a compile-time error.
          const _exhaustive: never = e;
          return _exhaustive;
        }
      }
    }
    check({ kind: "agreed", rowKey: "r", colId: "c", value: 1 });
  });

  it("does not include a previousValue field on agreed", () => {
    type AgreedKeys = keyof Extract<ReconcileEvent, { kind: "agreed" }>;
    expectTypeOf<AgreedKeys>().toEqualTypeOf<"kind" | "rowKey" | "colId" | "value">();
  });
});

describe("LevelSnapshot.serverManaged", () => {
  it("is required (not optional)", () => {
    type ServerManagedKey = "serverManaged";
    type SnapshotRequiredKeys = {
      [K in keyof LevelSnapshot]-?: undefined extends LevelSnapshot[K] ? never : K;
    }[keyof LevelSnapshot];
    expectTypeOf<ServerManagedKey>().toMatchTypeOf<SnapshotRequiredKeys>();
  });

  it("has the three boolean concerns", () => {
    expectTypeOf<LevelSnapshot["serverManaged"]>().toEqualTypeOf<{
      sort: boolean;
      filter: boolean;
      pagination: boolean;
    }>();
  });
});
