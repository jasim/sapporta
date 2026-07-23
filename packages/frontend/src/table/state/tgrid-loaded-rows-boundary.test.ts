import { describe, expect, it, vi } from "vitest";
import {
  makeRowId,
  rootPath,
  type LoadedRowsBoundaryEvent,
  type SourceLoadResult,
} from "@sapporta/grid";
import type { TGridSession } from "./tgrid-session";
import type { TGridRowsByLevel } from "../grid-adapter/tgrid-types";
import { paginateTGridLoadedRowsBoundary } from "./tgrid-loaded-rows-boundary";

type RowsByLevel = {
  orders: {
    id: number;
  };
};

function boundary(direction: "before" | "after"): LoadedRowsBoundaryEvent {
  const path = rootPath("orders");
  return {
    kind: "cell",
    loadPath: path,
    direction,
    origin: {
      path,
      rowId: makeRowId(path, "1"),
      colId: "id",
    },
    colPolicy: "preserve",
    extend: false,
  };
}

function policyHarness({
  page,
  pageSize,
  totalCount,
  loadedRowCount,
}: {
  page: number;
  pageSize: number;
  totalCount: number | null;
  loadedRowCount: number;
}): {
  session: TGridSession<RowsByLevel>;
  setLevelPage: ReturnType<typeof vi.fn>;
} {
  const sourceState = {
    status: "ready",
    snapshot: {
      nodes: Array.from({ length: loadedRowCount }, (_, index) => ({
        rowKey: String(index + 1),
      })),
    },
  };
  const unchangedResult = {
    kind: "unchanged",
    state: sourceState,
  } as unknown as SourceLoadResult;
  const setLevelPage = vi.fn(() => Promise.resolve(unchangedResult));
  const session = {
    rootLevel: "orders",
    levels: {
      orders: {
        config: {
          query: {
            owner: "host",
          },
        },
      },
    },
    getQueryState: () => ({
      page,
      pageSize,
      totalCount,
    }),
    runtime: {
      level: () => ({
        data: {
          state: () => sourceState,
        },
      }),
    },
    setLevelPage,
  } as unknown as TGridSession<RowsByLevel>;

  return { session, setLevelPage };
}

describe("paginateTGridLoadedRowsBoundary", () => {
  it("loads the previous page through the session command", () => {
    const { session, setLevelPage } = policyHarness({
      page: 2,
      pageSize: 25,
      totalCount: 50,
      loadedRowCount: 25,
    });
    const event = boundary("before");

    const result = paginateTGridLoadedRowsBoundary(event, "orders", session);

    expect(result).not.toBe(false);
    expect(setLevelPage).toHaveBeenCalledWith("orders", event.loadPath, 1, 25);
  });

  it("declines navigation before the first page", () => {
    const { session, setLevelPage } = policyHarness({
      page: 1,
      pageSize: 25,
      totalCount: 50,
      loadedRowCount: 25,
    });

    expect(
      paginateTGridLoadedRowsBoundary(boundary("before"), "orders", session),
    ).toBe(false);
    expect(setLevelPage).not.toHaveBeenCalled();
  });

  it("declines navigation after the known final page", () => {
    const { session, setLevelPage } = policyHarness({
      page: 2,
      pageSize: 25,
      totalCount: 50,
      loadedRowCount: 25,
    });

    expect(
      paginateTGridLoadedRowsBoundary(boundary("after"), "orders", session),
    ).toBe(false);
    expect(setLevelPage).not.toHaveBeenCalled();
  });

  it("uses a short page as the final boundary when the total is unknown", () => {
    const { session, setLevelPage } = policyHarness({
      page: 3,
      pageSize: 25,
      totalCount: null,
      loadedRowCount: 4,
    });

    expect(
      paginateTGridLoadedRowsBoundary(boundary("after"), "orders", session),
    ).toBe(false);
    expect(setLevelPage).not.toHaveBeenCalled();
  });
});
