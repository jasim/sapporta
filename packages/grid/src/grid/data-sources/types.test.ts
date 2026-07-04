import { describe, expectTypeOf, it } from "vitest";
import type {
  LevelDataSource,
  LevelSnapshot,
  ReconcileEvent,
  WriteCapability,
} from "./types";

describe("LevelDataSource capability surface", () => {
  it("keeps write verbs behind the optional write capability", () => {
    expectTypeOf<LevelDataSource["write"]>().toEqualTypeOf<
      WriteCapability | undefined
    >();
  });

  it("does not expose write verbs on the source itself", () => {
    // @ts-expect-error — callers must go through source.write.
    type _SetCell = LevelDataSource["setCell"];
    // @ts-expect-error — callers must go through source.write.
    type _CreateNode = LevelDataSource["createNode"];
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
    expectTypeOf<AgreedKeys>().toEqualTypeOf<
      "kind" | "rowKey" | "colId" | "value"
    >();
  });
});

describe("LevelSnapshot", () => {
  it("requires only the renderable nodes payload", () => {
    type NodesKey = "nodes";
    type SnapshotRequiredKeys = {
      [K in keyof LevelSnapshot]-?: undefined extends LevelSnapshot[K]
        ? never
        : K;
    }[keyof LevelSnapshot];
    expectTypeOf<NodesKey>().toEqualTypeOf<SnapshotRequiredKeys>();
  });

  it("does not carry query or pagination metadata", () => {
    // @ts-expect-error — server/local query policy belongs to capabilities.
    type _ServerManaged = LevelSnapshot["serverManaged"];
    // @ts-expect-error — page state belongs to the source or host.
    type _Pagination = LevelSnapshot["pagination"];
  });
});
